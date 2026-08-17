# COGS Calculator — Spec

A small, local, single-purpose tool for modeling unit economics and total budget
for a physical product (backpack), owned by one person, used by two partners.
Not a QuickBooks replacement — a sandbox for answering "what should this cost"
and "what should we budget" before money moves, with a lockable record once it does.

## Mental model

- **Product** — a bucket/container for one product line (e.g. "Backpack v1").
  You can have multiple products eventually; v1 only needs one, but the schema
  supports more from day one.
- **Transaction** — one line item in that product's ledger (e.g. "Design",
  "Manufacturing — Vendor A", "Inbound freight"). This is the "ingredient" in
  your recipe metaphor. Every dollar in the model is a transaction.
- **Draft vs Locked** — a product's transactions are always live/editable
  ("draft"). When you actually place an order, you **lock** it: this takes a
  timestamped, read-only snapshot of the current transactions + unit count +
  computed totals. The product then goes back to draft so you can keep
  planning the next order. Over time a product accumulates a history of
  locked snapshots — your real order history, distinct from your current
  planning sandbox.

## Data model

### `products`

| field | type | notes |
|---|---|---|
| id | integer PK | |
| name | text | e.g. "Backpack v1" |
| unit_count | integer | planned/target units for the current draft — drives amortization and tier resolution |
| currency | text | default `USD` |
| target_margin_pct | real, nullable | pricing input — see Pricing below |
| target_price | real, nullable | pricing input — see Pricing below |
| margin_basis | enum, default `cogs_only` | `cogs_only` or `fully_loaded` — which per-unit cost figure the pricing formula uses, see Pricing below |
| notes | text, nullable | free text |
| created_at / updated_at | datetime | |

### `transactions`

| field | type | notes |
|---|---|---|
| id | integer PK | |
| product_id | integer FK | |
| name | text | e.g. "Manufacturing — Vendor A" |
| type | enum | `nre`, `variable_cogs`, `marketing` |
| category | enum | `design`, `tooling`, `manufacturing`, `packaging`, `shipping`, `3pl_fulfillment`, `duties_tariffs`, `payment_fees`, `returns_allowance`, `cac`, `other` — enforced via CHECK constraint; adding a new value later is a small migration (see note below). Categorization convention: `shipping` = inbound freight, factory → your warehouse/3PL (yours to carry under FOB); outbound cost to the end customer belongs under `3pl_fulfillment`. Not schema-enforced — just pick one and stay consistent so rollups by category stay meaningful. |
| unit_basis | enum | `lump_sum` or `per_unit` — defaults from `type` (nre→lump_sum, variable_cogs→per_unit, marketing→per_unit) but overridable, since e.g. a total ad budget for launch is a lump sum, not per-unit |
| amount | real, nullable | flat per-unit or lump-sum price. Null/unused if this transaction has tiers — see Implementation notes on why tiers and a top-level amount are mutually exclusive |
| is_active | boolean, default true | inactive transactions are saved but excluded from all totals — this is how "alternatives" work |
| alternative_group | text, nullable | soft label (e.g. "Manufacturer") — UI groups transactions sharing a label and warns (doesn't block) if more than one in a group is active at once. UI input is an autocomplete/datalist sourced from group labels already used on this product, so "Manufacturer" and "manufacturer" don't silently become two ungrouped labels for a non-technical user typing free text |
| notes | text, nullable | |
| created_at / updated_at | datetime | |

### `transaction_tiers`

Quantity-based price breaks (your `<=300 units = $X, else $Y` case). Only
meaningful for `per_unit` transactions.

| field | type | notes |
|---|---|---|
| id | integer PK | |
| transaction_id | integer FK | |
| min_qty | integer | tier applies when `product.unit_count >= min_qty` |
| amount | real | per-unit price at this tier |

Resolution rule: pick the tier with the **highest `min_qty` that is `<=`
`product.unit_count`**. A tiered transaction must include one tier with
`min_qty: 0`, so there's always a match and no fallback case — see
Implementation notes below for why there's no separate "base amount" to
fall back to.

### `snapshots` (created on "lock")

| field | type | notes |
|---|---|---|
| id | integer PK | |
| product_id | integer FK | |
| locked_at | datetime | |
| unit_count | integer | value at time of lock |
| transactions_json | text (JSON) | frozen copy of every active transaction, tier-resolved, at lock time |
| total_budget | real | computed value at lock time, see Formulas |
| per_unit_cost_cogs_only | real | " |
| per_unit_cost_fully_loaded | real | " |
| target_margin_pct | real, nullable | " |
| target_price | real, nullable | " |
| margin_basis | enum | `cogs_only` or `fully_loaded` — which cost basis was driving the margin/price fields at lock time, so the historical record is unambiguous even if the toggle default changes later |
| notes | text, nullable | e.g. "First order, placed with Vendor A" |

## Formulas (computed live, not stored, except inside a snapshot)

Let:
- `variable_cogs_per_unit` = sum of `amount` (tier-resolved) for active transactions where `type = variable_cogs`, normalized to per-unit (lump-sum variable_cogs items divide by `unit_count`)
- `nre_total` = sum of `amount` for active transactions where `type = nre`, normalized to a lump sum (per-unit nre items multiply by `unit_count` — rare, but supported)
- `marketing_per_unit` and `marketing_total` = same pattern for `type = marketing` (Projected CAC). **Assumption**: a `per_unit` CAC transaction assumes 1 customer acquired per unit in `unit_count` — i.e. units manufactured and customers acquired are treated as the same number. If that's ever not true for a given order (returns, samples, sell-through under 100%, multi-batch launch), don't fight the math — just switch that transaction's `unit_basis` to `lump_sum` and type the total marketing budget directly instead of a per-unit figure.

Then:
- **`per_unit_cost_cogs_only`** = `variable_cogs_per_unit`
  — the "true COGS," what pricing/gross-margin math should be based on.
- **`per_unit_cost_fully_loaded`** = `variable_cogs_per_unit + (nre_total / unit_count) + marketing_per_unit`
  — the "what does one unit really cost us all-in" number, informational, not used for margin math.
- **`total_budget`** = `nre_total + (variable_cogs_per_unit * unit_count) + marketing_total`
  — "how much cash do we need to place this order and acquire these customers."

### Pricing (live two-way fields)

`target_margin_pct` and `target_price` are both editable on the product.
Whichever one you last typed into "drives" the other, computed off
whichever per-unit cost figure `margin_basis` points to (default
`cogs_only`; a UI toggle switches it to `fully_loaded` when you want
design-amortization and CAC baked into the margin math instead):

- edit margin → `target_price = cost_basis / (1 - target_margin_pct)`
- edit price → `target_margin_pct = (target_price - cost_basis) / target_price`

where `cost_basis` = `per_unit_cost_cogs_only` or `per_unit_cost_fully_loaded`
depending on `margin_basis`. Both margin/price fields are always shown
filled in, so you can see cost-plus and working-backward views
simultaneously without picking a "mode" — the only mode is the cost basis
toggle.

## Implementation notes (fresh-eyes gotchas)

Things that read as obvious once written down but are easy to get wrong at
build time:

- **Percent convention**: store `target_margin_pct` as a decimal (`0.35`),
  not a whole number (`35`). Prevents `/100` conversions from creeping into
  some formulas/UI code and not others.
- **Divide-by-zero**: every formula above divides by `unit_count` somewhere.
  `unit_count` must be `>= 1` — default a new product to `1` and have the
  UI treat "not a real number yet" as a blank/"—" summary rather than
  crashing or showing `Infinity`.
- **Margin ⇄ price update loop**: the two linked pricing fields must not
  both blindly recalc each other on every keystroke, or they'll fight.
  Recalculate only the field that *wasn't* just edited, and trigger off
  blur/change rather than on every input event.
- **Tiers have no separate fallback amount.** A transaction is either
  flat-priced (`amount` set, no tier rows) or fully tiered (tier rows only,
  `amount` unused, one tier at `min_qty: 0`) — never both. One number to
  look at per pricing model, instead of a base amount plus an edge case for
  when quantity falls below every tier.

## UI (single HTML page)

One page, no build step, vanilla HTML/CSS/JS. Sections:

0. **Product tabs** — one tab per row in `products`, across the top. The UI always operates on exactly one active product at a time; switching tabs loads that product's transactions and summary. A "+ new product" tab creates another bucket. This means multi-product was never a schema afterthought — it's tabbed from the start, you just won't have a reason to click "+" for a while.
1. **Product header** — name, unit_count input, currency (fixed to USD for v1), draft/locked state indicator, lock history (list of past snapshots, expandable).
2. **Transaction table** — the ledger. Columns: name, type, category, unit_basis, amount (or "tiered" indicator + expandable tier rows), active toggle, alternative_group, notes. Add-row form at the bottom. Editing any cell recalculates the summary panel live.
3. **Summary panel** — `per_unit_cost_cogs_only`, `per_unit_cost_fully_loaded`, `total_budget`, `target_margin_pct` / `target_price` (linked fields as above), plus the `margin_basis` toggle (COGS-only / fully-loaded) that decides which cost figure drives the margin↔price math. This is the "here's what we're looking at spending" screen.
4. **Save button** — explicit save, writes current draft state to the DB. No autosave.
5. **Lock button** — only enabled in draft; prompts for optional notes, creates a `snapshots` row, product stays in draft afterward for the next round.
6. **Glossary / help** — small "?" tooltip icons next to jargon-y labels (NRE, COGS, margin vs. markup, FOB, tier, amortize, lump sum, etc.), plus a bottom expandable "Glossary" panel listing all terms at once. Term text/definitions live in a separate constants file (e.g. `glossary.js`, an array of `{term, definition}`), not inlined in the HTML — the tooltip/panel components just read from it, so adding or editing a definition never touches markup. Include the CAC/`unit_count` assumption above as its own glossary entry (not just a term definition, but the actual "here's what this number assumes" caveat) — it's the one place in the tool where a plain number quietly encodes a business assumption, so it's worth surfacing right where people will type it in, not just in this spec doc.

## Tech stack

- **Backend**: Node + Express, small REST API (products, transactions, tiers, snapshots — standard CRUD plus a `/lock` endpoint).
- **DB**: SQLite (single file, zero install, trivially backed up/shared between the two of you) via `better-sqlite3` or similar.
- **Frontend**: one static HTML file + one JS file, no framework, fetch() calls to the local API.
- **Run locally**: `node server.js`, open `localhost:PORT` in a browser. No hosting, no auth, no SaaS.

## Confirmed decisions

- Alternatives (vendor A vs B) and quantity tiers are **separate mechanisms** — `is_active`/`alternative_group` for the former, `transaction_tiers` for the latter.
- NRE **auto-amortizes** into `per_unit_cost_fully_loaded`, and is also shown un-amortized in `total_budget` — both numbers surfaced side by side.
- Locking **snapshots and reopens** — the draft stays editable indefinitely; locked orders accumulate as history.
- Pricing uses **live two-way fields** (margin ⇄ price), no explicit `pricing_type` selector. Margin math defaults to **COGS-only** cost; a `margin_basis` toggle switches to fully-loaded when wanted.
- Freight terms are **FOB** for this product (affects what belongs in the `shipping` category — inbound freight from factory is yours to carry; doesn't change the schema, just how you categorize).
- **Projected CAC is a plain typed-in line item** (`marketing`/`cac` transaction), no live ad-platform integration. An optional scratch-calc helper (spend ÷ conversions) in the UI can populate the `amount` field, but it's a one-time calculation aid, not a stored formula.
- **Multi-product baked into the schema from day one**, with the UI showing one active product at a time via tabs — adding a second product later is just clicking "+ new product," not a rework.
- **Categories are a locked enum** (`design`, `tooling`, `manufacturing`, `packaging`, `shipping`, `3pl_fulfillment`, `duties_tariffs`, `payment_fees`, `returns_allowance`, `cac`, `other`), including an `other` catch-all for anything that doesn't fit yet. If a real recurring need emerges under `other`, promoting it to its own category is a small migration (add the enum value / update the CHECK constraint) — not a redesign.
- **Duties/tariffs and 3PL fulfillment are in scope for v1** as first-class categories, same treatment as any other transaction (per-unit or lump-sum, active/inactive, tierable if needed).

## Assumptions to confirm or override

- **USD only** for v1 — no multi-currency handling.
- **No auth, no multi-user concurrency handling, local use only** — this is a two-person, mostly-one-editor tool on a shared file/DB; not building for simultaneous conflicting edits or any hosted access.

## Out of scope for v1

- Payment processing fees, returns/warranty allowance — supported as `category` values whenever you're ready to add them as transactions, but no special calculation logic beyond the standard per-unit/lump-sum treatment.
- PDF/CSV export.
- Any external integrations (ad platforms, accounting software, manufacturer APIs).
- Multi-currency.
- Real auth / hosted access from outside your machine(s).

