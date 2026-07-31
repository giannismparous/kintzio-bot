import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let bundle = null;
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..'
);

function vectorNorm(values) {
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum);
}

export async function initStaticBotStore(bundlePath) {
  const absolute = path.isAbsolute(bundlePath)
    ? bundlePath
    : path.resolve(repositoryRoot, bundlePath);
  const parsed = JSON.parse(await fs.readFile(absolute, 'utf8'));
  if (!parsed?.bot?.id || !Array.isArray(parsed.chunks) || !parsed.chunks.length) {
    throw new Error(`Invalid static bot bundle: ${absolute}`);
  }
  bundle = {
    ...parsed,
    chunks: parsed.chunks.map((chunk) => ({
      ...chunk,
      norm: vectorNorm(chunk.embedding),
    })),
  };
  console.log(`Loaded static bot bundle (${bundle.chunks.length} chunks)`);
}

export function getStaticBot(botId) {
  return bundle?.bot?.id === botId ? bundle.bot : null;
}

export function staticBotIsReady() {
  return Boolean(bundle);
}

export function searchStaticBot(botId, queryEmbedding, limit = 6) {
  if (!bundle || bundle.bot.id !== botId) return [];
  const queryNorm = vectorNorm(queryEmbedding);
  if (!queryNorm) return [];

  return bundle.chunks
    .map((chunk) => {
      let dot = 0;
      const length = Math.min(queryEmbedding.length, chunk.embedding.length);
      for (let i = 0; i < length; i += 1) {
        dot += queryEmbedding[i] * chunk.embedding[i];
      }
      return {
        id: chunk.id,
        sourceId: chunk.sourceId,
        content: chunk.content,
        score: chunk.norm ? dot / (queryNorm * chunk.norm) : 0,
        label: chunk.label,
        uri: chunk.uri,
        sourceType: chunk.sourceType,
        showInCitations: chunk.showInCitations,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
