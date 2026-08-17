import { Router, Request, Response, NextFunction } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import {
  CATEGORIES,
  MARGIN_BASES,
  TRANSACTION_TYPES,
  UNIT_BASES,
  MarginBasis,
  ProductRow,
  TierRow,
  TransactionRow,
} from './types';
import {
  computeCostSummary,
  costBasisFor,
  marginFromPrice,
  priceFromMargin,
  resolveTierAmount,
  ResolvedTransaction,
} from './calc';

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function asId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `Invalid id: ${raw}`);
  return id;
}

// ---- row <-> JSON shaping (snake_case DB columns <-> camelCase API) ----

function productToJson(row: ProductRow) {
  return {
    id: row.id,
    name: row.name,
    unitCount: row.unit_count,
    currency: row.currency,
    targetMarginPct: row.target_margin_pct,
    targetPrice: row.target_price,
    marginBasis: row.margin_basis,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function tierToJson(row: TierRow) {
  return { id: row.id, minQty: row.min_qty, amount: row.amount };
}

function transactionToJson(row: TransactionRow, tiers: TierRow[]) {
  return {
    id: row.id,
    productId: row.product_id,
    name: row.name,
    type: row.type,
    category: row.category,
    unitBasis: row.unit_basis,
    amount: row.amount,
    isActive: row.is_active === 1,
    alternativeGroup: row.alternative_group,
    notes: row.notes,
    tiers: tiers.map(tierToJson),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function snapshotToJson(row: {
  id: number;
  product_id: number;
  locked_at: string;
  unit_count: number;
  transactions_json: string;
  total_budget: number;
  per_unit_cost_cogs_only: number;
  per_unit_cost_fully_loaded: number;
  target_margin_pct: number | null;
  target_price: number | null;
  margin_basis: MarginBasis;
  notes: string | null;
}) {
  return {
    id: row.id,
    productId: row.product_id,
    lockedAt: row.locked_at,
    unitCount: row.unit_count,
    transactions: JSON.parse(row.transactions_json),
    totalBudget: row.total_budget,
    perUnitCostCogsOnly: row.per_unit_cost_cogs_only,
    perUnitCostFullyLoaded: row.per_unit_cost_fully_loaded,
    targetMarginPct: row.target_margin_pct,
    targetPrice: row.target_price,
    marginBasis: row.margin_basis,
    notes: row.notes,
  };
}

// ---- validation ----

function validateTransactionInput(body: any, { partial }: { partial: boolean }) {
  const errors: string[] = [];
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  if ((!partial || has('name')) && (typeof body.name !== 'string' || !body.name.trim())) {
    errors.push('name is required');
  }
  if ((!partial || has('type')) && !TRANSACTION_TYPES.includes(body.type)) {
    errors.push(`type must be one of ${TRANSACTION_TYPES.join(', ')}`);
  }
  if ((!partial || has('category')) && !CATEGORIES.includes(body.category)) {
    errors.push(`category must be one of ${CATEGORIES.join(', ')}`);
  }
  if ((!partial || has('unitBasis')) && !UNIT_BASES.includes(body.unitBasis)) {
    errors.push(`unitBasis must be one of ${UNIT_BASES.join(', ')}`);
  }

  // The UI sends `tiers: null` to mean "no tiers, use amount instead" —
  // treat that the same as the key being absent.
  const tiersRaw = has('tiers') ? body.tiers : undefined;
  const tiers = tiersRaw === null ? undefined : tiersRaw;
  if (tiers !== undefined) {
    if (!Array.isArray(tiers) || tiers.length === 0) {
      errors.push('tiers, if provided, must be a non-empty array');
    } else {
      const hasBaseTier = tiers.some((t: any) => Number(t.minQty) === 0);
      if (!hasBaseTier) errors.push('tiered transactions must include one tier with minQty: 0');
      for (const t of tiers) {
        if (typeof t.minQty !== 'number' || t.minQty < 0) errors.push('each tier needs a minQty >= 0');
        if (typeof t.amount !== 'number') errors.push('each tier needs a numeric amount');
      }
    }
  }

  // A transaction is flat-priced OR tiered, never both (see cogscalc.md).
  const amountProvided = has('amount') && body.amount !== null && body.amount !== undefined;
  if (tiers !== undefined && tiers.length > 0 && amountProvided) {
    errors.push('a transaction cannot have both a top-level amount and tiers — pick one');
  }
  if (!partial && tiers === undefined && !amountProvided) {
    errors.push('provide either amount or tiers');
  }

  if (errors.length) throw new ApiError(400, errors.join('; '));
}

// ---- summary assembly ----

function loadTransactionsWithTiers(db: DatabaseSync, productId: number) {
  const txRows = db
    .prepare('SELECT * FROM transactions WHERE product_id = ? ORDER BY created_at ASC, id ASC')
    .all(productId) as unknown as TransactionRow[];
  const tierStmt = db.prepare('SELECT * FROM transaction_tiers WHERE transaction_id = ? ORDER BY min_qty ASC');
  return txRows.map((row) => ({
    row,
    tiers: tierStmt.all(row.id) as unknown as TierRow[],
  }));
}

function resolveAmount(row: TransactionRow, tiers: TierRow[], unitCount: number): number {
  if (tiers.length > 0) {
    return resolveTierAmount(
      tiers.map((t) => ({ minQty: t.min_qty, amount: t.amount })),
      unitCount,
    );
  }
  return row.amount ?? 0;
}

function summarizeProduct(db: DatabaseSync, product: ProductRow) {
  const withTiers = loadTransactionsWithTiers(db, product.id);
  const resolved: ResolvedTransaction[] = withTiers.map(({ row, tiers }) => ({
    type: row.type,
    unitBasis: row.unit_basis,
    isActive: row.is_active === 1,
    amount: resolveAmount(row, tiers, product.unit_count),
  }));
  const summary = computeCostSummary(resolved, product.unit_count);
  return { summary, withTiers };
}

// ---- router ----

export function createRouter(db: DatabaseSync): Router {
  const router = Router();

  function getProductOr404(id: number): ProductRow {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as unknown as
      | ProductRow
      | undefined;
    if (!product) throw new ApiError(404, `Product ${id} not found`);
    return product;
  }

  router.get('/meta', (_req, res) => {
    res.json({
      categories: CATEGORIES,
      transactionTypes: TRANSACTION_TYPES,
      unitBases: UNIT_BASES,
      marginBases: MARGIN_BASES,
    });
  });

  // ---- products ----

  router.get('/products', (_req, res) => {
    const rows = db.prepare('SELECT * FROM products ORDER BY created_at ASC, id ASC').all() as unknown as ProductRow[];
    res.json(rows.map(productToJson));
  });

  router.post('/products', (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) throw new ApiError(400, 'name is required');
    const unitCount = Number.isInteger(req.body.unitCount) && req.body.unitCount >= 1 ? req.body.unitCount : 1;

    const info = db
      .prepare('INSERT INTO products (name, unit_count) VALUES (?, ?)')
      .run(name, unitCount);
    const product = getProductOr404(Number(info.lastInsertRowid));
    res.status(201).json(productToJson(product));
  });

  router.get('/products/:id', (req, res) => {
    const product = getProductOr404(asId(req.params.id));
    const { summary, withTiers } = summarizeProduct(db, product);
    const snapshots = db
      .prepare('SELECT * FROM snapshots WHERE product_id = ? ORDER BY locked_at DESC, id DESC')
      .all(product.id) as unknown as any[];

    res.json({
      product: productToJson(product),
      transactions: withTiers.map(({ row, tiers }) => transactionToJson(row, tiers)),
      summary: {
        ...summary,
        costBasis: costBasisFor(summary, product.margin_basis),
      },
      snapshots: snapshots.map(snapshotToJson),
    });
  });

  router.patch('/products/:id', (req, res) => {
    const id = asId(req.params.id);
    const existing = getProductOr404(id);
    const body = req.body ?? {};

    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existing.name;
    const unitCount = Number.isInteger(body.unitCount) && body.unitCount >= 1 ? body.unitCount : existing.unit_count;
    const notes = 'notes' in body ? body.notes : existing.notes;
    const marginBasis = MARGIN_BASES.includes(body.marginBasis) ? body.marginBasis : existing.margin_basis;

    db.prepare(
      `UPDATE products SET name = ?, unit_count = ?, notes = ?, margin_basis = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(name, unitCount, notes, marginBasis, id);

    res.json(productToJson(getProductOr404(id)));
  });

  router.delete('/products/:id', (req, res) => {
    const id = asId(req.params.id);
    getProductOr404(id);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    res.status(204).end();
  });

  // Recompute one side of the margin/price pair from the other, off the
  // product's current cost basis, and persist both. Called on blur, not on
  // every keystroke — see Implementation notes in cogscalc.md.
  router.post('/products/:id/pricing', (req, res) => {
    const id = asId(req.params.id);
    const product = getProductOr404(id);
    const { field, value } = req.body ?? {};

    if (field !== 'margin' && field !== 'price') {
      throw new ApiError(400, "field must be 'margin' or 'price'");
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ApiError(400, 'value must be a finite number');
    }

    const { summary } = summarizeProduct(db, product);
    const costBasis = costBasisFor(summary, product.margin_basis);

    let targetMarginPct: number | null;
    let targetPrice: number | null;
    if (field === 'margin') {
      targetMarginPct = value;
      targetPrice = priceFromMargin(costBasis, value);
    } else {
      targetPrice = value;
      targetMarginPct = marginFromPrice(costBasis, value);
    }

    db.prepare(
      `UPDATE products SET target_margin_pct = ?, target_price = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(targetMarginPct, targetPrice, id);

    res.json({ targetMarginPct, targetPrice, costBasis, marginBasis: product.margin_basis });
  });

  router.post('/products/:id/lock', (req, res) => {
    const id = asId(req.params.id);
    const product = getProductOr404(id);
    const { summary, withTiers } = summarizeProduct(db, product);

    const activeTransactionsSnapshot = withTiers
      .filter(({ row }) => row.is_active === 1)
      .map(({ row, tiers }) => transactionToJson(row, tiers));

    const notes = typeof req.body?.notes === 'string' ? req.body.notes : null;

    const info = db
      .prepare(
        `INSERT INTO snapshots (
          product_id, unit_count, transactions_json, total_budget,
          per_unit_cost_cogs_only, per_unit_cost_fully_loaded,
          target_margin_pct, target_price, margin_basis, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        product.unit_count,
        JSON.stringify(activeTransactionsSnapshot),
        summary.totalBudget,
        summary.perUnitCostCogsOnly,
        summary.perUnitCostFullyLoaded,
        product.target_margin_pct,
        product.target_price,
        product.margin_basis,
        notes,
      );

    const snapshot = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(Number(info.lastInsertRowid));
    res.status(201).json(snapshotToJson(snapshot as any));
  });

  // Read-only "what if" recompute: same cost math as GET /products/:id, but
  // against a hypothetical unit count instead of the product's stored one.
  // Nothing is written — just reuses computeCostSummary with a different divisor.
  router.get('/products/:id/simulate', (req, res) => {
    const id = asId(req.params.id);
    const product = getProductOr404(id);

    const unitCount = Number(req.query.unitCount);
    if (!Number.isInteger(unitCount) || unitCount < 1) {
      throw new ApiError(400, 'unitCount query param must be a positive integer');
    }

    const withTiers = loadTransactionsWithTiers(db, product.id);
    const resolved: ResolvedTransaction[] = withTiers.map(({ row, tiers }) => ({
      type: row.type,
      unitBasis: row.unit_basis,
      isActive: row.is_active === 1,
      amount: resolveAmount(row, tiers, unitCount),
    }));
    const summary = computeCostSummary(resolved, unitCount);
    const costBasis = costBasisFor(summary, product.margin_basis);

    res.json({
      productId: product.id,
      unitCount,
      summary: { ...summary, costBasis },
      marginBasis: product.margin_basis,
      impliedMarginAtCurrentTargetPrice:
        product.target_price != null ? marginFromPrice(costBasis, product.target_price) : null,
      priceAtCurrentTargetMargin:
        product.target_margin_pct != null ? priceFromMargin(costBasis, product.target_margin_pct) : null,
    });
  });

  router.get('/products/:id/snapshots', (req, res) => {
    const id = asId(req.params.id);
    getProductOr404(id);
    const rows = db
      .prepare('SELECT * FROM snapshots WHERE product_id = ? ORDER BY locked_at DESC, id DESC')
      .all(id) as unknown as any[];
    res.json(rows.map(snapshotToJson));
  });

  // ---- transactions ----

  function writeTiers(transactionId: number, tiers: { minQty: number; amount: number }[] | undefined) {
    db.prepare('DELETE FROM transaction_tiers WHERE transaction_id = ?').run(transactionId);
    if (!tiers || tiers.length === 0) return;
    const insert = db.prepare('INSERT INTO transaction_tiers (transaction_id, min_qty, amount) VALUES (?, ?, ?)');
    for (const t of tiers) insert.run(transactionId, t.minQty, t.amount);
  }

  router.post('/products/:id/transactions', (req, res) => {
    const productId = asId(req.params.id);
    getProductOr404(productId);
    const body = req.body ?? {};
    validateTransactionInput(body, { partial: false });

    const amount = body.tiers ? null : body.amount;
    const isActive = body.isActive === false ? 0 : 1;

    const info = db
      .prepare(
        `INSERT INTO transactions (
          product_id, name, type, category, unit_basis, amount,
          is_active, alternative_group, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        productId,
        body.name.trim(),
        body.type,
        body.category,
        body.unitBasis,
        amount,
        isActive,
        body.alternativeGroup || null,
        body.notes || null,
      );

    const transactionId = Number(info.lastInsertRowid);
    writeTiers(transactionId, body.tiers);

    const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId) as unknown as TransactionRow;
    const tiers = db
      .prepare('SELECT * FROM transaction_tiers WHERE transaction_id = ? ORDER BY min_qty ASC')
      .all(transactionId) as unknown as TierRow[];
    res.status(201).json(transactionToJson(row, tiers));
  });

  function getTransactionOr404(id: number): TransactionRow {
    const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as unknown as
      | TransactionRow
      | undefined;
    if (!row) throw new ApiError(404, `Transaction ${id} not found`);
    return row;
  }

  router.patch('/transactions/:id', (req, res) => {
    const id = asId(req.params.id);
    const existing = getTransactionOr404(id);
    const body = req.body ?? {};
    validateTransactionInput(body, { partial: true });

    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existing.name;
    const type = body.type ?? existing.type;
    const category = body.category ?? existing.category;
    const unitBasis = body.unitBasis ?? existing.unit_basis;
    const isActive = 'isActive' in body ? (body.isActive ? 1 : 0) : existing.is_active;
    const alternativeGroup = 'alternativeGroup' in body ? body.alternativeGroup || null : existing.alternative_group;
    const notes = 'notes' in body ? body.notes || null : existing.notes;

    const tiersProvided = 'tiers' in body;
    const amount = tiersProvided
      ? body.tiers
        ? null
        : (body.amount ?? existing.amount)
      : ('amount' in body ? body.amount : existing.amount);

    db.prepare(
      `UPDATE transactions SET
        name = ?, type = ?, category = ?, unit_basis = ?, amount = ?,
        is_active = ?, alternative_group = ?, notes = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(name, type, category, unitBasis, amount, isActive, alternativeGroup, notes, id);

    if (tiersProvided) writeTiers(id, body.tiers);

    const row = getTransactionOr404(id);
    const tiers = db
      .prepare('SELECT * FROM transaction_tiers WHERE transaction_id = ? ORDER BY min_qty ASC')
      .all(id) as unknown as TierRow[];
    res.json(transactionToJson(row, tiers));
  });

  router.delete('/transactions/:id', (req, res) => {
    const id = asId(req.params.id);
    getTransactionOr404(id);
    db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    res.status(204).end();
  });

  return router;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
}

export { ApiError };
