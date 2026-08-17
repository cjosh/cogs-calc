import {
  computeCostSummary,
  costBasisFor,
  marginFromPrice,
  priceFromMargin,
  resolveTierAmount,
  ResolvedTransaction,
} from '../src/calc';

describe('resolveTierAmount', () => {
  it('picks the highest tier at or below unit count', () => {
    const tiers = [
      { minQty: 0, amount: 20 },
      { minQty: 300, amount: 15 },
      { minQty: 1000, amount: 11 },
    ];
    expect(resolveTierAmount(tiers, 50)).toBe(20);
    expect(resolveTierAmount(tiers, 300)).toBe(15);
    expect(resolveTierAmount(tiers, 999)).toBe(15);
    expect(resolveTierAmount(tiers, 1000)).toBe(11);
    expect(resolveTierAmount(tiers, 5000)).toBe(11);
  });

  it('throws if there is no min_qty: 0 tier to fall back to', () => {
    const tiers = [{ minQty: 300, amount: 15 }];
    expect(() => resolveTierAmount(tiers, 50)).toThrow(/no tier covering min_qty 0/);
  });
});

describe('computeCostSummary', () => {
  const base = (overrides: Partial<ResolvedTransaction>): ResolvedTransaction => ({
    type: 'variable_cogs',
    unitBasis: 'per_unit',
    isActive: true,
    amount: 0,
    ...overrides,
  });

  it('sums per-unit variable COGS directly', () => {
    const txs = [base({ amount: 10 }), base({ amount: 2.5 })];
    const summary = computeCostSummary(txs, 500);
    expect(summary.variableCogsPerUnit).toBeCloseTo(12.5);
    expect(summary.perUnitCostCogsOnly).toBeCloseTo(12.5);
  });

  it('normalizes a lump-sum variable COGS item to per-unit', () => {
    const txs = [base({ amount: 1000, unitBasis: 'lump_sum' })];
    const summary = computeCostSummary(txs, 500);
    expect(summary.variableCogsPerUnit).toBeCloseTo(2);
  });

  it('amortizes NRE into fully-loaded per-unit cost but not into COGS-only', () => {
    const txs = [
      base({ amount: 10 }),
      base({ type: 'nre', unitBasis: 'lump_sum', amount: 5900 }),
    ];
    const summary = computeCostSummary(txs, 500);
    expect(summary.nreTotal).toBe(5900);
    expect(summary.perUnitCostCogsOnly).toBeCloseTo(10);
    expect(summary.perUnitCostFullyLoaded).toBeCloseTo(10 + 5900 / 500);
  });

  it('folds NRE and total budget correctly', () => {
    const txs = [
      base({ amount: 10 }),
      base({ type: 'nre', unitBasis: 'lump_sum', amount: 5900 }),
    ];
    const summary = computeCostSummary(txs, 500);
    expect(summary.totalBudget).toBeCloseTo(5900 + 10 * 500);
  });

  it('treats per-unit marketing as 1 customer per manufactured unit (documented assumption)', () => {
    const txs = [base({ type: 'marketing', unitBasis: 'per_unit', amount: 25 })];
    const summary = computeCostSummary(txs, 500);
    expect(summary.marketingPerUnit).toBeCloseTo(25);
    expect(summary.marketingTotal).toBeCloseTo(25 * 500);
  });

  it('normalizes a lump-sum marketing budget to a per-unit figure for the fully-loaded number', () => {
    const txs = [base({ type: 'marketing', unitBasis: 'lump_sum', amount: 10000 })];
    const summary = computeCostSummary(txs, 500);
    expect(summary.marketingTotal).toBe(10000);
    expect(summary.marketingPerUnit).toBeCloseTo(20);
  });

  it('excludes inactive (alternative) transactions from every total', () => {
    const txs = [base({ amount: 10, isActive: true }), base({ amount: 999, isActive: false })];
    const summary = computeCostSummary(txs, 100);
    expect(summary.variableCogsPerUnit).toBeCloseTo(10);
  });

  it('guards unit_count against 0/negative/fractional input instead of dividing by zero', () => {
    const txs = [base({ type: 'nre', unitBasis: 'lump_sum', amount: 100 })];
    expect(() => computeCostSummary(txs, 0)).not.toThrow();
    const summary = computeCostSummary(txs, 0);
    expect(Number.isFinite(summary.perUnitCostFullyLoaded)).toBe(true);
    expect(summary.perUnitCostFullyLoaded).toBeCloseTo(100); // treated as unit_count = 1
  });
});

describe('costBasisFor', () => {
  const summary = computeCostSummary(
    [
      { type: 'variable_cogs', unitBasis: 'per_unit', isActive: true, amount: 10 },
      { type: 'nre', unitBasis: 'lump_sum', isActive: true, amount: 5900 },
    ],
    500,
  );

  it('uses COGS-only cost by default', () => {
    expect(costBasisFor(summary, 'cogs_only')).toBeCloseTo(summary.perUnitCostCogsOnly);
  });

  it('switches to fully-loaded when asked', () => {
    expect(costBasisFor(summary, 'fully_loaded')).toBeCloseTo(summary.perUnitCostFullyLoaded);
  });
});

describe('priceFromMargin / marginFromPrice (live two-way pricing fields)', () => {
  it('computes price from a target margin', () => {
    expect(priceFromMargin(10, 0.5)).toBeCloseTo(20);
  });

  it('computes margin from a target price', () => {
    expect(marginFromPrice(10, 20)).toBeCloseTo(0.5);
  });

  it('round-trips: margin -> price -> margin returns the original margin', () => {
    const price = priceFromMargin(12.5, 0.35)!;
    expect(marginFromPrice(12.5, price)).toBeCloseTo(0.35);
  });

  it('returns null instead of Infinity for a 100%+ margin', () => {
    expect(priceFromMargin(10, 1)).toBeNull();
    expect(priceFromMargin(10, 1.2)).toBeNull();
  });

  it('returns null instead of dividing by zero for a $0 target price', () => {
    expect(marginFromPrice(10, 0)).toBeNull();
  });

  it('allows a negative margin (selling below cost) rather than treating it as invalid', () => {
    expect(marginFromPrice(10, 8)).toBeCloseTo(-0.25);
  });
});
