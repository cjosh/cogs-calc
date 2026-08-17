// Terminal chat REPL for read-only questions about products, transactions,
// and cost economics. Talks to Claude via the Vercel AI SDK; Claude answers
// by calling tools that hit this app's own running Express API — no direct
// DB access here, so all the existing validation/calc logic in routes.ts /
// calc.ts is reused as-is. Nothing in this script writes data.
//
// Usage: start the server (`npm start`) in one terminal, then in another:
//   ANTHROPIC_API_KEY=sk-ant-... npm run chat
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { z } from 'zod';
// `ai` and `@ai-sdk/anthropic` ship ESM-only; this project builds to
// CommonJS (see tsconfig.json), so they're loaded via dynamic import() in
// main() below rather than a static import. Type-only imports are erased at
// compile time and don't hit that restriction.
import type { ModelMessage } from 'ai' with { 'resolution-mode': 'import' };

const API_BASE = process.env.COGSCALC_API_URL || 'http://localhost:3000';
const MODEL = 'claude-haiku-4-5';

async function apiGet(pathAndQuery: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api${pathAndQuery}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`API ${pathAndQuery} -> ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

// `tool` comes from the dynamically-imported `ai` module (see main()), so
// this is built as a function rather than a module-level const.
function buildTools(tool: (typeof import('ai', { with: { 'resolution-mode': 'import' } }))['tool']) {
  return {
    listProducts: tool({
      description: 'List every product tracked in cogscalc, with id, name, and unit count.',
      inputSchema: z.object({}),
      execute: async () => apiGet('/products'),
    }),
    getProduct: tool({
      description:
        'Get full detail for one product: its transactions (with category, type, amount, ' +
        'and any quantity tiers), the computed cost summary (per-unit COGS, fully-loaded ' +
        'cost, total budget, marketing/CAC spend), current target margin and price, and ' +
        'past locked snapshots. Use this for "show me product X" style questions, and to ' +
        "read individual transaction categories (e.g. filter for category 'cac' to answer " +
        'CAC questions) since the API does not pre-filter by category.',
      inputSchema: z.object({
        productId: z.number().int().positive().describe('The numeric product id from listProducts.'),
      }),
      execute: async ({ productId }: { productId: number }) => apiGet(`/products/${productId}`),
    }),
    simulateUnitCount: tool({
      description:
        'Recompute cost summary and margin for a product at a hypothetical unit count, ' +
        'without changing anything stored. Use this for "what if I ordered N units" or ' +
        '"what would the margin be at N units" questions.',
      inputSchema: z.object({
        productId: z.number().int().positive(),
        unitCount: z.number().int().positive().describe('The hypothetical order quantity to test.'),
      }),
      execute: async ({ productId, unitCount }: { productId: number; unitCount: number }) =>
        apiGet(`/products/${productId}/simulate?unitCount=${unitCount}`),
    }),
  };
}

const SYSTEM_PROMPT = `You answer questions about product cost economics using the cogscalc tool set.
All data is read-only — you cannot create, edit, or delete products or transactions, and no tool here does that.
Amounts are in each product's currency; state figures plainly (e.g. "$4.20/unit") without inventing precision the data doesn't have.
When a question needs a product you haven't identified yet, call listProducts first.
Keep answers concise — a sentence or a short list, not a report.`;

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY before running this (see the Anthropic Console for a key).');
    process.exitCode = 1;
    return;
  }

  const { streamText, tool, stepCountIs } = await import('ai');
  const { anthropic } = await import('@ai-sdk/anthropic');
  const tools = buildTools(tool);

  const rl = readline.createInterface({ input, output });
  const history: ModelMessage[] = [];

  console.log(`cogscalc chat (${MODEL}) — talking to ${API_BASE}. Read-only. Ctrl+C to quit.\n`);

  for (;;) {
    const userInput = await rl.question('> ');
    if (!userInput.trim()) continue;

    history.push({ role: 'user', content: userInput });

    const result = streamText({
      model: anthropic(MODEL),
      system: SYSTEM_PROMPT,
      messages: history,
      tools,
      stopWhen: stepCountIs(5),
    });

    for await (const chunk of result.textStream) {
      output.write(chunk);
    }
    output.write('\n');

    history.push(...(await result.responseMessages));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
