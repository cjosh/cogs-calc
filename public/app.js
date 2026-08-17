import { GLOSSARY, FIELD_HELP } from './glossary.js';

const state = {
  meta: null,
  products: [],
  activeProductId: null,
  detail: null, // { product, transactions, summary, snapshots }
};

const CATEGORY_LABELS = {
  design: 'Design',
  tooling: 'Tooling (molds/dies/jigs)',
  manufacturing: 'Manufacturing',
  packaging: 'Packaging',
  shipping: 'Shipping (inbound)',
  '3pl_fulfillment': '3PL / Fulfillment',
  duties_tariffs: 'Duties / Tariffs',
  payment_fees: 'Payment fees',
  returns_allowance: 'Returns allowance',
  cac: 'Projected CAC (marketing)',
  other: 'Other',
};

const TYPE_LABELS = { nre: 'NRE (one-time)', variable_cogs: 'Variable COGS', marketing: 'Marketing' };
const BASIS_LABELS = { lump_sum: 'Lump sum', per_unit: 'Per unit' };

const money = (n) =>
  n === null || n === undefined || Number.isNaN(n)
    ? '—'
    : n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
const pct = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `${(n * 100).toFixed(1)}%`);

async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json;
}

// ---- tiers shorthand: "0:20, 300:15" <-> [{minQty:0,amount:20}, ...] ----

function parseTiers(text) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.split(',').map((chunk) => {
    const [minQtyRaw, amountRaw] = chunk.split(':').map((s) => s.trim());
    const minQty = Number(minQtyRaw);
    const amount = Number(amountRaw);
    if (!Number.isFinite(minQty) || !Number.isFinite(amount)) {
      throw new Error(`Can't parse tier "${chunk.trim()}" — use minQty:amount, e.g. 0:20, 300:15`);
    }
    return { minQty, amount };
  });
}

function formatTiers(tiers) {
  if (!tiers || tiers.length === 0) return '';
  return tiers.map((t) => `${t.minQty}:${t.amount}`).join(', ');
}

// ---- loading ----

async function loadProducts() {
  state.products = await api('GET', '/products');
  if (!state.activeProductId && state.products.length > 0) {
    state.activeProductId = state.products[0].id;
  }
}

async function loadDetail() {
  if (!state.activeProductId) {
    state.detail = null;
    return;
  }
  state.detail = await api('GET', `/products/${state.activeProductId}`);
}

async function refreshAll() {
  await loadProducts();
  await loadDetail();
  render();
}

// ---- rendering ----

function render() {
  renderTabs();
  const app = document.getElementById('app');
  if (!state.detail) {
    app.hidden = true;
    return;
  }
  app.hidden = false;
  renderProductHeader();
  renderTransactionTable();
  renderSummary();
  renderSnapshots();
}

function renderTabs() {
  const nav = document.getElementById('productTabs');
  nav.innerHTML = '';
  for (const p of state.products) {
    const btn = document.createElement('button');
    btn.textContent = p.name;
    btn.className = 'tab' + (p.id === state.activeProductId ? ' active' : '');
    btn.addEventListener('click', async () => {
      state.activeProductId = p.id;
      await loadDetail();
      render();
    });
    nav.appendChild(btn);
  }
  const addBtn = document.createElement('button');
  addBtn.textContent = '+ New product';
  addBtn.className = 'tab tab-new';
  addBtn.addEventListener('click', async () => {
    const name = prompt('Product name (e.g. "Backpack v1")');
    if (!name || !name.trim()) return;
    const created = await api('POST', '/products', { name: name.trim() });
    state.activeProductId = created.id;
    await refreshAll();
  });
  nav.appendChild(addBtn);
}

function renderProductHeader() {
  const { product, snapshots } = state.detail;
  document.getElementById('productName').value = product.name;
  document.getElementById('productUnitCount').value = product.unitCount;
  document.getElementById('productMarginBasis').value = product.marginBasis;
  document.getElementById('productNotes').value = product.notes || '';
  const badge = document.getElementById('stateBadge');
  badge.textContent = snapshots.length > 0 ? `Draft (${snapshots.length} locked order${snapshots.length > 1 ? 's' : ''} on file)` : 'Draft';
}

function optionsHtml(map, selected) {
  return Object.entries(map)
    .map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`)
    .join('');
}

function renderTransactionTable() {
  const { transactions, product } = state.detail;
  const tbody = document.getElementById('txRows');
  tbody.innerHTML = '';

  const groups = new Set(transactions.map((t) => t.alternativeGroup).filter(Boolean));
  document.getElementById('alternativeGroupOptions').innerHTML = [...groups]
    .map((g) => `<option value="${g}"></option>`)
    .join('');

  for (const tx of transactions) {
    tbody.appendChild(transactionRow(tx, product));
  }

  const addRow = document.getElementById('txAddRow');
  addRow.innerHTML = '';
  addRow.appendChild(transactionRow(null, product));
}

function transactionRow(tx, product) {
  const tr = document.createElement('tr');
  const isNew = !tx;

  const name = el('input', { type: 'text', value: tx?.name || '', placeholder: 'e.g. Manufacturing — Vendor A' });
  const type = el('select', {}, optionsHtml(TYPE_LABELS, tx?.type || 'variable_cogs'));
  const category = el('select', {}, optionsHtml(CATEGORY_LABELS, tx?.category || 'other'));
  const basis = el('select', {}, optionsHtml(BASIS_LABELS, tx?.unitBasis || 'per_unit'));
  const amount = el('input', {
    type: 'number',
    step: '0.01',
    value: tx?.amount ?? '',
    placeholder: 'flat price',
  });
  const tiers = el('input', {
    type: 'text',
    value: formatTiers(tx?.tiers),
    placeholder: '0:20, 300:15',
  });
  const active = el('input', { type: 'checkbox' });
  active.checked = tx ? tx.isActive : true;
  const group = el('input', { type: 'text', value: tx?.alternativeGroup || '', list: 'alternativeGroupOptions' });
  const notes = el('input', { type: 'text', value: tx?.notes || '' });

  // Amount and tiers are mutually exclusive — mirror the backend rule in the UI.
  const syncExclusivity = () => {
    amount.disabled = tiers.value.trim().length > 0;
    tiers.disabled = amount.value.trim().length > 0 && !amount.disabled;
  };
  amount.addEventListener('input', syncExclusivity);
  tiers.addEventListener('input', syncExclusivity);
  syncExclusivity();

  const actionBtn = el('button', { class: 'small' }, isNew ? 'Add' : 'Save');
  const deleteBtn = isNew ? null : el('button', { class: 'small danger' }, 'Delete');

  actionBtn.addEventListener('click', async () => {
    try {
      const payload = {
        name: name.value.trim(),
        type: type.value,
        category: category.value,
        unitBasis: basis.value,
        isActive: active.checked,
        alternativeGroup: group.value.trim() || null,
        notes: notes.value.trim() || null,
      };
      const parsedTiers = parseTiers(tiers.value);
      if (parsedTiers) {
        payload.tiers = parsedTiers;
        payload.amount = null;
      } else {
        payload.amount = amount.value === '' ? null : Number(amount.value);
        payload.tiers = null;
      }

      if (isNew) {
        await api('POST', `/products/${product.id}/transactions`, payload);
      } else {
        await api('PATCH', `/transactions/${tx.id}`, payload);
      }
      await loadDetail();
      render();
    } catch (err) {
      alert(err.message);
    }
  });

  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete "${tx.name}"?`)) return;
      await api('DELETE', `/transactions/${tx.id}`);
      await loadDetail();
      render();
    });
  }

  const cells = [name, type, category, basis, amount, tiers, active, group, notes];
  for (const cell of cells) {
    const td = document.createElement('td');
    td.appendChild(cell);
    tr.appendChild(td);
  }
  const actionsTd = document.createElement('td');
  actionsTd.appendChild(actionBtn);
  if (deleteBtn) actionsTd.appendChild(deleteBtn);
  tr.appendChild(actionsTd);

  return tr;
}

function el(tag, attrs, html) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  if (html !== undefined) node.innerHTML = html;
  if ('value' in (attrs || {}) && tag === 'input') node.value = attrs.value;
  return node;
}

function renderSummary() {
  const { summary, product } = state.detail;
  document.getElementById('statCogsOnly').textContent = money(summary.perUnitCostCogsOnly);
  document.getElementById('statFullyLoaded').textContent = money(summary.perUnitCostFullyLoaded);
  document.getElementById('statBudget').textContent = money(summary.totalBudget);
  document.getElementById('priceMargin').value = product.targetMarginPct ?? '';
  document.getElementById('priceTarget').value = product.targetPrice ?? '';
}

function renderSnapshots() {
  const list = document.getElementById('snapshotList');
  list.innerHTML = '';
  const { snapshots } = state.detail;
  if (snapshots.length === 0) {
    list.innerHTML = '<p class="hint">No locked orders yet — this product is still a planning draft.</p>';
    return;
  }
  for (const s of snapshots) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `${new Date(s.lockedAt).toLocaleString()} — ${s.unitCount} units — ${money(s.totalBudget)} budget${s.notes ? ` — ${s.notes}` : ''}`;
    const body = document.createElement('div');
    body.className = 'snapshot-body';
    body.innerHTML = `
      <p>COGS-only per unit: ${money(s.perUnitCostCogsOnly)} · Fully-loaded per unit: ${money(s.perUnitCostFullyLoaded)}</p>
      <p>Margin: ${pct(s.targetMarginPct)} (basis: ${s.marginBasis}) · Target price: ${money(s.targetPrice)}</p>
      <p>Line items at lock time:</p>
      <ul>${s.transactions.map((t) => `<li>${t.name} — ${CATEGORY_LABELS[t.category] || t.category} — ${t.tiers?.length ? formatTiers(t.tiers) : money(t.amount)} (${BASIS_LABELS[t.unitBasis]})</li>`).join('')}</ul>
    `;
    details.appendChild(summary);
    details.appendChild(body);
    list.appendChild(details);
  }
}

function renderGlossary() {
  const dl = document.getElementById('glossaryList');
  dl.innerHTML = GLOSSARY.map((g) => `<dt>${g.term}</dt><dd>${g.definition}</dd>`).join('');
}

// ---- "?" tooltips: click-to-toggle, text pulled from glossary.js ----

function initTooltips() {
  document.querySelectorAll('.qmark[data-help]').forEach((q) => {
    const text = FIELD_HELP[q.dataset.help];
    if (text) q.setAttribute('data-tip', text);
  });
  document.addEventListener('click', (e) => {
    const q = e.target.closest('.qmark');
    // A .qmark can sit inside a <label> wrapping an input/select — without
    // this, clicking it also fires the browser's native "forward click to
    // the labeled control" behavior, which bubbles a second click (target =
    // the input) that immediately closes the tooltip we just opened.
    if (q) e.preventDefault();
    document.querySelectorAll('.qmark.open').forEach((el) => {
      if (el !== q) el.classList.remove('open');
    });
    if (q) q.classList.toggle('open');
  });
}

// ---- wiring ----

document.getElementById('saveProductBtn').addEventListener('click', async () => {
  const { product } = state.detail;
  await api('PATCH', `/products/${product.id}`, {
    name: document.getElementById('productName').value.trim(),
    unitCount: Number(document.getElementById('productUnitCount').value) || 1,
    marginBasis: document.getElementById('productMarginBasis').value,
    notes: document.getElementById('productNotes').value,
  });
  await loadDetail();
  render();
});

document.getElementById('lockBtn').addEventListener('click', async () => {
  const { product } = state.detail;
  if (!confirm(`Lock in this order for "${product.name}" at ${product.unitCount} units? This creates a permanent record; the draft stays editable afterward.`)) return;
  const notes = prompt('Optional note for this order (e.g. "Placed with Vendor A"):') || null;
  await api('POST', `/products/${product.id}/lock`, { notes });
  await loadDetail();
  render();
});

document.getElementById('deleteProductBtn').addEventListener('click', async () => {
  const { product } = state.detail;
  if (!confirm(`Delete "${product.name}" and all its transactions and locked orders? This can't be undone.`)) return;
  await api('DELETE', `/products/${product.id}`);
  state.activeProductId = null;
  await refreshAll();
});

async function submitPricing(field) {
  const { product } = state.detail;
  const raw = field === 'margin' ? document.getElementById('priceMargin').value : document.getElementById('priceTarget').value;
  if (raw === '') return;
  const result = await api('POST', `/products/${product.id}/pricing`, { field, value: Number(raw) });
  document.getElementById('priceMargin').value = result.targetMarginPct ?? '';
  document.getElementById('priceTarget').value = result.targetPrice ?? '';
}

document.getElementById('priceMargin').addEventListener('blur', () => submitPricing('margin').catch((e) => alert(e.message)));
document.getElementById('priceTarget').addEventListener('blur', () => submitPricing('price').catch((e) => alert(e.message)));
document.getElementById('recalcBtn').addEventListener('click', () => submitPricing('margin').catch((e) => alert(e.message)));

// ---- init ----

(async function init() {
  renderGlossary();
  initTooltips();
  state.meta = await api('GET', '/meta');
  await refreshAll();
  if (state.products.length === 0) {
    const name = prompt('No products yet. Name your first one (e.g. "Backpack v1"):');
    if (name && name.trim()) {
      const created = await api('POST', '/products', { name: name.trim() });
      state.activeProductId = created.id;
      await refreshAll();
    }
  }
})();
