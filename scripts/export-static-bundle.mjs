import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, closeDb, pool } from '../apps/api/src/config.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(rootDir, 'data', 'kintzio-bundle.json');
const BOT_ID = '7c1e1708-93eb-5e52-8f3c-e8fbf4f92df4';

try {
  await initDb();
  const { rows: bots } = await pool.query('SELECT * FROM bots WHERE id = $1', [BOT_ID]);
  if (!bots[0]) throw new Error('Kintzio bot is not present in the local database');

  const { rows: chunks } = await pool.query(
    `SELECT c.id, c.content, c.embedding, c.page_url,
            s.id AS source_id, s.label, s.uri, s.type AS source_type,
            s.show_in_citations
     FROM chunks c
     JOIN sources s ON s.id = c.source_id
     WHERE c.bot_id = $1 AND c.embedding IS NOT NULL
     ORDER BY s.created_at, c.ordinal`,
    [BOT_ID]
  );
  if (!chunks.length) throw new Error('Build the local bot before exporting its bundle');

  const bundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    bot: bots[0],
    chunks: chunks.map((chunk) => ({
      id: chunk.id,
      sourceId: chunk.source_id,
      content: chunk.content,
      embedding:
        typeof chunk.embedding === 'string'
          ? JSON.parse(chunk.embedding)
          : chunk.embedding,
      pageUrl: chunk.page_url,
      label: chunk.page_url || chunk.label,
      uri: chunk.page_url || chunk.uri,
      sourceType: chunk.source_type,
      showInCitations: chunk.show_in_citations !== false,
    })),
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(bundle));
  console.log(`Exported ${chunks.length} chunks to ${outputPath}`);
} finally {
  await closeDb().catch(() => {});
}
