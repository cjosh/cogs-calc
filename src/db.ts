// Storage: Node's built-in `node:sqlite` (stable enough to use, still flagged
// experimental by Node itself — see README). Deliberately not using a
// third-party driver like better-sqlite3: this is a single-file local tool
// for two people, and the built-in module means one less compiled
// dependency to vet or have break on an npm registry incident.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { CATEGORIES, MARGIN_BASES, TRANSACTION_TYPES, UNIT_BASES } from './types';

function sqlList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ');
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit_count INTEGER NOT NULL DEFAULT 1 CHECK (unit_count >= 1),
  currency TEXT NOT NULL DEFAULT 'USD',
  target_margin_pct REAL,
  target_price REAL,
  margin_basis TEXT NOT NULL DEFAULT 'cogs_only' CHECK (margin_basis IN (${sqlList(MARGIN_BASES)})),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (${sqlList(TRANSACTION_TYPES)})),
  category TEXT NOT NULL CHECK (category IN (${sqlList(CATEGORIES)})),
  unit_basis TEXT NOT NULL CHECK (unit_basis IN (${sqlList(UNIT_BASES)})),
  amount REAL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  alternative_group TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transaction_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  min_qty INTEGER NOT NULL,
  amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  locked_at TEXT NOT NULL DEFAULT (datetime('now')),
  unit_count INTEGER NOT NULL,
  transactions_json TEXT NOT NULL,
  total_budget REAL NOT NULL,
  per_unit_cost_cogs_only REAL NOT NULL,
  per_unit_cost_fully_loaded REAL NOT NULL,
  target_margin_pct REAL,
  target_price REAL,
  margin_basis TEXT NOT NULL CHECK (margin_basis IN (${sqlList(MARGIN_BASES)})),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_product ON transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_tiers_transaction ON transaction_tiers(transaction_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_product ON snapshots(product_id);
`;

// __dirname at runtime is dist/src (see tsconfig rootDir/outDir) — go up two
// levels to the project root, not one, so the DB lives outside dist/ and
// survives a rebuild (dist/ is gitignored and safe to wipe at any time).
const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'data', 'cogscalc.db');

export function createDb(dbPath: string = process.env.DB_PATH || DEFAULT_DB_PATH): DatabaseSync {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_SQL);
  return db;
}
