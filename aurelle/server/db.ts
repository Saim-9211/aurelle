import 'dotenv/config';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import pg from 'pg';
import { readFile, mkdir, open, rename, copyFile, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
export interface SQL {
  query<T = any>(
    text: string,
    params?: any[],
  ): Promise<{ rows: T[]; affectedRows?: number; rowCount?: number | null }>;
}
export const TENANT = '11111111-1111-4111-8111-111111111111';
export const BRANCH = '22222222-2222-4222-8222-222222222222';
export const SECOND_BRANCH = '22222222-2222-4222-8222-222222222223';
export let db: SQL;
export const tenantContext = new AsyncLocalStorage<string>();
let raw: SQL;
let embedded: PGlite | undefined;
let pool: pg.Pool | undefined;
let gate: Promise<unknown> = Promise.resolve();
let snapshotFile: string | undefined;
let lockValue: string | undefined;
async function acquireLocalLock() {
  if (!snapshotFile) return;
  const path = snapshotFile + '.lock';
  try {
    const previous = JSON.parse(await readFile(path, 'utf8'));
    let alive = true;
    try {
      process.kill(previous.pid, 0);
    } catch (e: any) {
      if (e.code === 'ESRCH') alive = false;
    }
    if (alive)
      throw new Error(
        'Another local Aurelle process owns this database. Use npm run stop before starting another.',
      );
    await unlink(path);
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e;
  }
  lockValue = JSON.stringify({ pid: process.pid, instance: randomUUID() });
  const file = await open(path, 'wx');
  try {
    await file.writeFile(lockValue);
    await file.sync();
  } finally {
    await file.close();
  }
}
async function persistLocal() {
  if (!embedded || !snapshotFile) return;
  const dump = await embedded.dumpDataDir('gzip');
  const temp = snapshotFile + '.tmp';
  const file = await open(temp, 'w');
  try {
    await file.writeFile(Buffer.from(await dump.arrayBuffer()));
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await copyFile(snapshotFile, snapshotFile + '.previous');
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e;
  }
  await rename(temp, snapshotFile);
}
export async function initDB(memory = false, migrate = false) {
  if (process.env.DATABASE_URL && !memory) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
    raw = pool;
  } else {
    if (process.env.NODE_ENV === 'production' && !memory)
      throw new Error(
        'Production requires DATABASE_URL. Embedded storage is local development only.',
      );
    snapshotFile = memory
      ? undefined
      : resolve(process.env.DATA_FILE || '.data/studio.pglite.tar.gz');
    let loadDataDir: Blob | undefined;
    if (snapshotFile) {
      await mkdir(dirname(snapshotFile), { recursive: true });
      await acquireLocalLock();
      try {
        loadDataDir = new Blob([await readFile(snapshotFile)]);
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    // Local development uses complete PostgreSQL snapshots, atomically replaced after writes.
    // It never reopens a partially-written live WASM data directory after an interrupted process.
    embedded = new PGlite({ loadDataDir, extensions: { btree_gist } });
    await embedded.waitReady;
    raw = embedded;
  }
  db = {
    query: async <T = any>(text: string, params?: any[]) => {
      const tenant = tenantContext.getStore();
      return tenant || (embedded && /^(INSERT|UPDATE|DELETE)/i.test(text.trim()))
        ? transaction((tx) => tx.query<T>(text, params), tenant)
        : raw.query<T>(text, params);
    },
  };
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  if (embedded) await embedded.exec(schema);
  else if (migrate || process.env.NODE_ENV !== 'production') await raw.query(schema);
  if (pool && process.env.NODE_ENV === 'production' && !migrate) {
    const role = await one(
      raw,
      "SELECT r.rolsuper,r.rolbypassrls,c.relowner=r.oid AS owns_tables FROM pg_roles r JOIN pg_class c ON c.relname='bookings' WHERE r.rolname=current_user",
    );
    if (!role || role.rolsuper || role.rolbypassrls || role.owns_tables)
      throw new Error(
        'Production requires a migrated database and a non-owner application role without BYPASSRLS.',
      );
  }
}
export async function transaction<T>(fn: (tx: SQL) => Promise<T>, tenant = TENANT): Promise<T> {
  const run = async () => {
    if (embedded) {
      let changed = false;
      const result = await embedded.transaction(async (tx) => {
        await tx.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
        await tx.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [tenant]);
        const tracked: SQL = {
          query: async <T = any>(text: string, params?: any[]) => {
            const result = await tx.query<T>(text, params);
            if (
              /^(INSERT|UPDATE|DELETE)/i.test(text.trim()) &&
              !/^UPDATE sessions SET last_seen/i.test(text.trim()) &&
              Number(result.affectedRows || 0) > 0
            )
              changed = true;
            return result;
          },
        };
        return fn(tracked);
      });
      if (changed) await persistLocal();
      return result;
    }
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
      await client.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [tenant]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  };
  if (!embedded) return run();
  const result = gate.then(run, run);
  gate = result.catch(() => {});
  return result;
}
export async function closeDB() {
  await gate;
  if (embedded) {
    await persistLocal();
    await embedded.close();
    embedded = undefined;
  }
  if (pool) {
    await pool.end();
    pool = undefined;
  }
  if (snapshotFile && lockValue) {
    try {
      if ((await readFile(snapshotFile + '.lock', 'utf8')) === lockValue)
        await unlink(snapshotFile + '.lock');
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  snapshotFile = undefined;
  lockValue = undefined;
}
export async function one<T = any>(
  tx: SQL,
  text: string,
  args: any[] = [],
): Promise<T | undefined> {
  return (await tx.query<T>(text, args)).rows[0];
}
