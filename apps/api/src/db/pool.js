import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../..');

function isPidAlive(pid) {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquirePgliteLock(dataDir) {
  const lockPath = path.join(dataDir, '.api.lock');
  fs.mkdirSync(dataDir, { recursive: true });

  if (fs.existsSync(lockPath)) {
    const pid = Number(String(fs.readFileSync(lockPath, 'utf8')).trim());
    if (isPidAlive(pid)) {
      throw new Error(
        `Database already in use (PID ${pid}). Stop the other API server before starting a new one.`
      );
    }
    fs.unlinkSync(lockPath);
  }

  fs.writeFileSync(lockPath, String(process.pid));
  return lockPath;
}

function releasePgliteLock(lockPath) {
  if (!lockPath || !fs.existsSync(lockPath)) return;
  try {
    const pid = Number(String(fs.readFileSync(lockPath, 'utf8')).trim());
    if (pid === process.pid) fs.unlinkSync(lockPath);
  } catch {
    /* ignore */
  }
}

/**
 * Thin pool wrapper so the rest of the API can use pg-style `.query` / `.connect()`.
 */
class PGlitePool {
  constructor(db, lockPath) {
    this.db = db;
    this.lockPath = lockPath;
  }

  async query(text, params = []) {
    const result = await this.db.query(text, params);
    return {
      rows: result.rows || [],
      rowCount: result.affectedRows ?? result.rows?.length ?? 0,
    };
  }

  async connect() {
    const self = this;
    return {
      query: (text, params) => self.query(text, params),
      release() {},
    };
  }

  async end() {
    await this.db.close?.();
    releasePgliteLock(this.lockPath);
  }
}

export async function createPool(databaseUrl) {
  const url = String(databaseUrl || '');
  if (url.startsWith('pglite:')) {
    const dataDir = url.replace(/^pglite:/, '') || './data/pglite';
    const absolute = path.isAbsolute(dataDir)
      ? dataDir
      : path.resolve(rootDir, dataDir);
    const lockPath = acquirePgliteLock(absolute);
    try {
      const db = await PGlite.create(absolute, {
        extensions: { vector },
      });
      await db.exec('CREATE EXTENSION IF NOT EXISTS vector;');
      console.log('Using PGlite at', absolute);
      return new PGlitePool(db, lockPath);
    } catch (err) {
      releasePgliteLock(lockPath);
      throw err;
    }
  }

  const pool = new pg.Pool({ connectionString: url });
  console.log('Using Postgres', url.replace(/:[^:@]+@/, ':***@'));
  return pool;
}
