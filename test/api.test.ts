import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server';
import { createDb } from '../src/db';

let server: Server;
let baseUrl: string;

beforeAll(() => {
  const db = createDb(':memory:');
  const app = createApp(db);
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

afterAll(() => {
  server.close();
});

async function api(method: string, urlPath: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  return { status: res.status, body: json };
}

describe('GET /api/meta', () => {
  it('exposes the shared enums the frontend renders dropdowns from', async () => {
    const { status, body } = await api('GET', '/meta');
    expect(status).toBe(200);
    expect(body.categories).toContain('tooling');
    expect(body.transactionTypes).toEqual(['nre', 'variable_cogs', 'marketing']);
  });
});

describe('end-to-end product lifecycle', () => {
  let productId: number;

  it('creates a product defaulting unit_count to 1', async () => {
    const { status, body } = await api('POST', '/products', { name: 'Backpack v1' });
    expect(status).toBe(201);
    expect(body.unitCount).toBe(1);
    productId = body.id;
  });

  it('sets a real unit count', async () => {
    const { status, body } = await api('PATCH', `/products/${productId}`, { unitCount: 500 });
    expect(status).toBe(200);
    expect(body.unitCount).toBe(500);
  });

  it('adds a flat-priced variable COGS transaction', async () => {
    const { status, body } = await api('POST', `/products/${productId}/transactions`, {
      name: 'Packaging',
      type: 'variable_cogs',
      category: 'packaging',
      unitBasis: 'per_unit',
      amount: 3.25,
    });
    expect(status).toBe(201);
    expect(body.amount).toBe(3.25);
  });

  it('adds a tiered manufacturing transaction', async () => {
    const { status, body } = await api('POST', `/products/${productId}/transactions`, {
      name: 'Manufacturing — Vendor A',
      type: 'variable_cogs',
      category: 'manufacturing',
      unitBasis: 'per_unit',
      tiers: [
        { minQty: 0, amount: 20 },
        { minQty: 300, amount: 15 },
      ],
    });
    expect(status).toBe(201);
    expect(body.amount).toBeNull();
    expect(body.tiers).toHaveLength(2);
  });

  it('adds the one-time design NRE cost', async () => {
    const { status, body } = await api('POST', `/products/${productId}/transactions`, {
      name: 'Design',
      type: 'nre',
      category: 'design',
      unitBasis: 'lump_sum',
      amount: 5900,
    });
    expect(status).toBe(201);
    expect(body.amount).toBe(5900);
  });

  it('rejects a transaction with both a top-level amount and tiers', async () => {
    const { status, body } = await api('POST', `/products/${productId}/transactions`, {
      name: 'Bad row',
      type: 'variable_cogs',
      category: 'other',
      unitBasis: 'per_unit',
      amount: 5,
      tiers: [{ minQty: 0, amount: 5 }],
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/cannot have both/);
  });

  it('rejects tiers missing a min_qty: 0 base tier', async () => {
    const { status, body } = await api('POST', `/products/${productId}/transactions`, {
      name: 'Bad tiers',
      type: 'variable_cogs',
      category: 'other',
      unitBasis: 'per_unit',
      tiers: [{ minQty: 300, amount: 5 }],
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/minQty: 0/);
  });

  it('rolls up the summary using the tier resolved at the current unit count (500 -> $15 tier)', async () => {
    const { status, body } = await api('GET', `/products/${productId}`);
    expect(status).toBe(200);
    // packaging 3.25 + manufacturing tier @500units = 15 => 18.25 COGS-only per unit
    expect(body.summary.perUnitCostCogsOnly).toBeCloseTo(18.25);
    expect(body.summary.perUnitCostFullyLoaded).toBeCloseTo(18.25 + 5900 / 500);
    expect(body.summary.totalBudget).toBeCloseTo(5900 + 18.25 * 500);
  });

  it('sets a target margin and gets back a computed price off COGS-only cost', async () => {
    const { status, body } = await api('POST', `/products/${productId}/pricing`, {
      field: 'margin',
      value: 0.5,
    });
    expect(status).toBe(200);
    expect(body.targetPrice).toBeCloseTo(18.25 / 0.5);
  });

  it('locks the product into a read-only snapshot and leaves the draft editable', async () => {
    const { status, body } = await api('POST', `/products/${productId}/lock`, {
      notes: 'First order, Vendor A',
    });
    expect(status).toBe(201);
    expect(body.unitCount).toBe(500);
    expect(body.transactions).toHaveLength(3);
    expect(body.marginBasis).toBe('cogs_only');

    const stillEditable = await api('PATCH', `/products/${productId}`, { unitCount: 600 });
    expect(stillEditable.status).toBe(200);
    expect(stillEditable.body.unitCount).toBe(600);
  });

  it('keeps the locked snapshot unchanged after the draft moves on', async () => {
    const { body } = await api('GET', `/products/${productId}/snapshots`);
    expect(body).toHaveLength(1);
    expect(body[0].unitCount).toBe(500); // frozen at lock time, not the current 600
  });
});

describe('validation', () => {
  it('404s for a product that does not exist', async () => {
    const { status, body } = await api('GET', '/products/999999');
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/);
  });

  it('accepts a flat-amount transaction where tiers is explicitly null (what the UI sends)', async () => {
    const { body: product } = await api('POST', '/products', { name: 'Temp2' });
    const { status, body } = await api('POST', `/products/${product.id}/transactions`, {
      name: 'Flat cost',
      type: 'variable_cogs',
      category: 'other',
      unitBasis: 'per_unit',
      amount: 4.5,
      tiers: null,
    });
    expect(status).toBe(201);
    expect(body.amount).toBe(4.5);
    expect(body.tiers).toHaveLength(0);
  });

  it('rejects an unknown category', async () => {
    const { body: product } = await api('POST', '/products', { name: 'Temp' });
    const { status, body } = await api('POST', `/products/${product.id}/transactions`, {
      name: 'Bad',
      type: 'variable_cogs',
      category: 'not_a_real_category',
      unitBasis: 'per_unit',
      amount: 1,
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/category must be one of/);
  });
});
