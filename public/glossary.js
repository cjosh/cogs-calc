// Plain-language definitions for the jargon in the calculator. Read by
// app.js to power the "?" tooltips and the bottom Glossary panel. Kept as
// data, not markup, so adding/editing a term never touches index.html.
export const GLOSSARY = [
  {
    term: 'NRE',
    definition:
      'Non-Recurring Engineering. A one-time cost you pay once, not per unit — e.g. paying a designer $5,900 to design the backpack. It does not scale with how many you make.',
  },
  {
    term: 'COGS',
    definition:
      'Cost Of Goods Sold — the direct per-unit cost to physically make one item (materials, manufacturing, packaging, inbound freight). Excludes one-time costs like design and excludes marketing.',
  },
  {
    term: 'Variable cost',
    definition: 'A cost that scales with how many units you make — the opposite of a one-time (NRE) cost.',
  },
  {
    term: 'Lump sum',
    definition: 'A total dollar amount for the whole order, not a per-item price. Example: "$10,000 total ad budget."',
  },
  {
    term: 'Per unit',
    definition: 'A price for one item. Multiply by however many units you’re making/selling to get a total.',
  },
  {
    term: 'Tier',
    definition:
      'A price that changes based on how many units you order — e.g. $20/unit if you order under 300, $15/unit at 300 or more. The calculator auto-picks the right tier from your unit count.',
  },
  {
    term: 'Amortize',
    definition:
      'Spreading a one-time cost across every unit you make, so it shows up as a small per-unit number instead of one big lump. $5,900 design cost amortized over 500 units = $11.80/unit.',
  },
  {
    term: 'Margin vs. markup',
    definition:
      'Margin = profit as a percent of the price you sell at. Markup = profit as a percent of what it cost you. This tool always uses margin (industry-standard "gross margin").',
  },
  {
    term: 'FOB',
    definition:
      'Free On Board. A shipping term meaning you (the buyer) take ownership and pay freight once goods leave the factory — inbound freight is your cost, not the factory’s.',
  },
  {
    term: 'COGS-only vs. fully-loaded cost',
    definition:
      'COGS-only = just the per-unit manufacturing cost, used for pricing/margin math. Fully-loaded = COGS-only plus your share of amortized design cost and marketing cost per unit — a "what does one unit really cost us" number, shown for information, not used to set price by default.',
  },
  {
    term: 'Projected CAC',
    definition:
      'Customer Acquisition Cost — roughly what it costs in marketing spend to get one paying customer. Called out as "projected" because, unlike a manufacturing quote, it is your own estimate, not a number a vendor gave you — the tool does not pull it from an ad account, and real CAC will drift once you actually start marketing.',
  },
  {
    term: 'Projected CAC and unit count',
    definition:
      'If you enter projected CAC as a per-unit dollar amount, the calculator assumes 1 customer acquired per unit you manufacture. If that is not true for your situation (returns, samples, multi-batch launches, expecting to sell fewer than you make), switch that line to a lump-sum total marketing budget instead of a per-unit number.',
  },
  {
    term: 'Alternative / vendor group',
    definition:
      'A label you give two or more competing quotes (e.g. "Manufacturer") so only one is counted toward your totals at a time, while you keep the others on record for comparison.',
  },
  {
    term: 'Draft vs. locked',
    definition:
      'Draft = your live planning sandbox, always editable. Locked = a frozen, timestamped snapshot taken when you actually place an order — a permanent record that will not change even if you keep editing the draft afterward.',
  },
  {
    term: 'Budget vs. unit cost',
    definition:
      'Unit cost = what one item costs. Budget = the total cash you need for the whole order (one-time costs + per-unit costs × quantity + marketing spend).',
  },
];

// Short-form text for the click-to-open "?" tooltips scattered around the
// form — keyed by a data-help id set on the .qmark span in index.html, so
// the markup never has to carry any of this wording itself.
export const FIELD_HELP = {
  unitCount:
    'How many units this draft’s numbers are based on — drives quantity tiers and how one-time costs get amortized.',
  marginBasis:
    'Which cost figure the margin/price fields below are calculated from: just COGS (default, industry-standard) or the fully-loaded number including amortized design cost and CAC.',
  transactionsIntro:
    'Every dollar in this model — one row per cost. NRE = one-time. Variable COGS = per-unit build cost. Marketing = CAC.',
  tiers:
    'Quantity price breaks, shorthand format: minQty:amount, minQty:amount — e.g. 0:20, 300:15. Leave blank to use the flat Amount field instead.',
  alternativeGroup:
    'Give two competing quotes the same label (e.g. Manufacturer) so only the active one counts toward your totals.',
  targetMargin:
    'Gross margin — the cut of your selling price that is profit, e.g. 0.5 = 50%. Calculated against the cost basis chosen above (COGS-only by default). Edit this or Target retail price and click away to recalculate the other.',
  perUnitCogsOnly: 'Just the per-unit build cost — what pricing/margin math is based on by default.',
  perUnitFullyLoaded:
    'COGS-only plus amortized design cost plus marketing cost per unit — informational, not used for margin math by default.',
  totalBudget:
    'All the cash you need for this order: one-time costs + per-unit costs × units + marketing spend.',
};
