import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const migrationsDir = path.join(__dirname, '../../../../data/migrations');

async function ensureMigrationTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function runMigrations(pool, { log = console.log } = {}) {
  await ensureMigrationTable(pool);

  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows: applied } = await pool.query('SELECT filename FROM schema_migrations');
  let done = new Set(applied.map((r) => r.filename));

  // DB existed before versioned migrations — record prior files without re-running SQL.
  if (done.size === 0 && files.length) {
    const { rows: existing } = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bots' LIMIT 1`
    );
    if (existing.length) {
      for (const file of files) {
        await pool.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
          [file]
        );
      }
      done = new Set(files);
      log?.('Existing database detected — migration history bootstrapped');
    }
  }

  for (const file of files) {
    if (done.has(file)) continue;

    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    if (typeof pool.db?.exec === 'function') {
      await pool.db.exec(sql);
    } else {
      await pool.query(sql);
    }
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    log?.(`Migration applied: ${file}`);
  }
}
