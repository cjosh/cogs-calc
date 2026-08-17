import express from 'express';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createDb } from './db';
import { createRouter, errorHandler } from './routes';

export function createApp(db: DatabaseSync) {
  const app = express();
  app.use(express.json());
  app.use('/api', createRouter(db));
  // __dirname at runtime is dist/src — public/ lives at the project root.
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));
  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  const db = createDb();
  const app = createApp(db);
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`cogscalc running at http://localhost:${port}`);
  });
}
