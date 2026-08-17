# cogscalcapp

Local COGS / unit-economics calculator. Implements the spec in
[https://github.com/cjosh/cogs-calc/blob/main/cogscalc.md](https://github.com/cjosh/cogs-calc/blob/main/cogscalc.md) . Runs entirely on your machine — no
hosting, no auth, no SaaS.

## Run it

```sh
npm install
npm run build
npm start
```

Then open http://localhost:3000 (override with `PORT=...`). Data is stored
in `data/cogscalc.db` (SQLite), created automatically on first run. Override
the location with `DB_PATH=...`.

## Develop

```sh
npm run typecheck   # tsc --noEmit
npm test            # jest — calc.ts unit tests + an end-to-end API test
```

There's no dev-server/watch script on purpose — this is a small, rarely-changed
tool; `npm run build && npm start` after an edit is enough.

## Notes

- **Storage** is Node's built-in `node:sqlite` (requires Node >= 22.5), not a
  third-party driver — one less dependency to vet, no native compile step.
  Node itself still flags the module experimental (API could change on a
  future Node upgrade); acceptable trade-off for a two-person local tool, but
  worth knowing if `npm start` ever breaks after a Node version bump.
- **Dependencies are pinned to exact versions** in `package.json` (no `^`/`~`).
  Bumping a version is a deliberate, reviewed action, not an automatic
  `npm install` side effect.
- All calculation logic (tier resolution, cost roll-ups, margin↔price math)
  lives in `src/calc.ts` as pure functions with no I/O — that's what
  `test/calc.test.ts` exercises directly.
