// Pure calculation functions — no DB, no I/O. Kept separate from the routes
// so the actual math (the part most worth getting right) is easy to unit
// test in isolation. Mirrors the formulas in cogscalc.md.

import { MarginBasis, TransactionType, UnitBasis } from './types';

export interface ResolvedTransaction {
  type: TransactionType;
  unitBasis: UnitBasis;
  isActive: boolean;
  /** Already tier-resolved if the transaction had tiers. */
  amount: number;
}

export interface CostSummary {
  variableCogsPerUnit: number;
  nreTotal: number;
  marketingPerUnit: number;
  marketingTotal: number;
  perUnitCostCogsOnly: number;
  perUnitCostFullyLoaded: number;
  totalBudget: number;
}

export interface Tier {
  minQty: number;
  amount: number;
}

/**
 * Highest min_qty tier that's <= unitCount. Every tiered transaction is
 * expected to carry a min_qty: 0 tier (enforced on write in routes.ts), so
 * this always resolves — no fallback branch to a separate base amount.
 */
export function resolveTierAmount(tiers: Tier[], unitCount: number): number {
  const applicable = tiers
    .filter((t) => t.minQty <= unitCount)
    .sort((a, b) => b.minQty - a.minQty);
  if (applicable.length === 0) {
    throw new Error('Tiered transaction has no tier covering min_qty 0 — invalid data');
  }
  return applicable[0].amount;
}

/** unit_count must be >= 1 everywhere it's used as a divisor. */
function normalizeUnitCount(unitCount: number): number {
  const n = Math.floor(unitCount);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function computeCostSummary(
  transactions: ResolvedTransaction[],
  unitCountRaw: number,
): CostSummary {
  const unitCount = normalizeUnitCount(unitCountRaw);

  let variableCogsPerUnit = 0;
  let nreTotal = 0;
  let marketingPerUnit = 0;
  let marketingTotal = 0;

  for (const t of transactions) {
    if (!t.isActive) continue;

    switch (t.type) {
      case 'variable_cogs':
        variableCogsPerUnit += t.unitBasis === 'per_unit' ? t.amount : t.amount / unitCount;
        break;
      case 'nre':
        nreTotal += t.unitBasis === 'lump_sum' ? t.amount : t.amount * unitCount;
        break;
      case 'marketing':
        if (t.unitBasis === 'per_unit') {
          marketingPerUnit += t.amount;
          marketingTotal += t.amount * unitCount;
        } else {
          marketingTotal += t.amount;
          marketingPerUnit += t.amount / unitCount;
        }
        break;
    }
  }

  const perUnitCostCogsOnly = variableCogsPerUnit;
  const perUnitCostFullyLoaded = variableCogsPerUnit + nreTotal / unitCount + marketingPerUnit;
  const totalBudget = nreTotal + variableCogsPerUnit * unitCount + marketingTotal;

  return {
    variableCogsPerUnit,
    nreTotal,
    marketingPerUnit,
    marketingTotal,
    perUnitCostCogsOnly,
    perUnitCostFullyLoaded,
    totalBudget,
  };
}

export function costBasisFor(summary: CostSummary, marginBasis: MarginBasis): number {
  return marginBasis === 'fully_loaded' ? summary.perUnitCostFullyLoaded : summary.perUnitCostCogsOnly;
}

/** null means "undefined at this input" (e.g. 100%+ margin) — caller shows "—", not NaN/Infinity. */
export function priceFromMargin(costBasis: number, marginPct: number): number | null {
  if (marginPct >= 1) return null;
  // USD has no sub-cent denomination — round here so it's clean everywhere
  // this value is stored, returned, or displayed, not just on screen.
  return Math.round((costBasis / (1 - marginPct)) * 100) / 100;
}

export function marginFromPrice(costBasis: number, price: number): number | null {
  if (price === 0) return null;
  return (price - costBasis) / price;
}
