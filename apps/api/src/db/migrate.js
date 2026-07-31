import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createPool } from './pool.js';
import { runMigrations } from './runMigrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../..');
dotenv.config({ path: path.join(rootDir, '.env') });

const databaseUrl = process.env.DATABASE_URL || 'pglite:./data/pglite';

async function migrate() {
  const pool = await createPool(databaseUrl);
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
