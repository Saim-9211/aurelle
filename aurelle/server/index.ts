import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { initDB, closeDB } from './db.ts';
import { seed } from './seed.ts';
import { createApp } from './app.ts';
import { startWorker } from './worker.ts';
import { token } from './domain.ts';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
const production = process.env.NODE_ENV === 'production';
if (
  production &&
  (!process.env.SESSION_SECRET ||
    process.env.SESSION_SECRET.length < 32 ||
    process.env.DEMO_MODE === 'true' ||
    process.env.SEED_DEMO === 'true')
)
  throw new Error('Production requires a strong SESSION_SECRET and demo/seed flags disabled.');
await initDB();
if (!production && process.env.SEED_DEMO !== 'false') await seed();
const app = createApp();
const server = createServer(app);
const port = Number(process.env.PORT || 3000);
const stopWorker = !production ? startWorker() : () => {};
if (!production) {
  const control = token();
  await mkdir('.data', { recursive: true });
  await writeFile(
    '.data/server-control.json',
    JSON.stringify({ port, pid: process.pid, token: control }),
  );
  app.post('/__development/shutdown', (req, res) => {
    if (req.headers.authorization !== `Bearer ${control}`) {
      res.sendStatus(403);
      return;
    }
    res.json({ stopping: true });
    setTimeout(() => void shutdown(), 100);
  });
}
if (production) {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({
    server: { middlewareMode: true, hmr: false },
    appType: 'spa',
  } as any);
  app.use(vite.middlewares);
}
server.listen(port, production ? '0.0.0.0' : '127.0.0.1', () =>
  console.log(`Aurelle is ready at http://localhost:${port}`),
);
async function shutdown() {
  await stopWorker();
  server.close();
  server.closeAllConnections();
  await closeDB();
  if (!production) await unlink('.data/server-control.json').catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
