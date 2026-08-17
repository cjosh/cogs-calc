// Shared enums. These arrays are the single source of truth: db.ts builds
// SQL CHECK constraints from them, and GET /api/meta serves them to the
// frontend so dropdown options never drift out of sync with validation.

export const CATEGORIES = [
  'design',
  'tooling',
  'manufacturing',
  'packaging',
  'shipping',
  '3pl_fulfillment',
  'duties_tariffs',
  'payment_fees',
  'returns_allowance',
  'cac',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const TRANSACTION_TYPES = ['nre', 'variable_cogs', 'marketing'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const UNIT_BASES = ['lump_sum', 'per_unit'] as const;
export type UnitBasis = (typeof UNIT_BASES)[number];

export const MARGIN_BASES = ['cogs_only', 'fully_loaded'] as const;
export type MarginBasis = (typeof MARGIN_BASES)[number];

export interface ProductRow {
  id: number;
  name: string;
  unit_count: number;
  currency: string;
  target_margin_pct: number | null;
  target_price: number | null;
  margin_basis: MarginBasis;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TierRow {
  id: number;
  transaction_id: number;
  min_qty: number;
  amount: number;
}

export interface TransactionRow {
  id: number;
  product_id: number;
  name: string;
  type: TransactionType;
  category: Category;
  unit_basis: UnitBasis;
  amount: number | null;
  is_active: 0 | 1;
  alternative_group: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SnapshotRow {
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
}
