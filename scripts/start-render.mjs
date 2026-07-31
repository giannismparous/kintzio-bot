import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const dataDir = process.env.KINTZIO_DATA_DIR || '/var/data';
const seedVersion = process.env.KINTZIO_SEED_VERSION || 'v1';
const markerPath = path.join(dataDir, `.kintzio-seeded-${seedVersion}`);

fs.mkdirSync(dataDir, { recursive: true });

if (!fs.existsSync(markerPath)) {
  console.log(`Kintzio seed ${seedVersion} not found; building the bot once.`);
  const result = spawnSync(
    process.execPath,
    ['scripts/seed-konstantinos.mjs', '--build'],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    }
  );
  if (result.status !== 0) {
    throw new Error(`Initial bot seed failed with exit code ${result.status}`);
  }
  fs.writeFileSync(markerPath, `${new Date().toISOString()}\n`);
}

await import('../apps/api/src/index.js');
