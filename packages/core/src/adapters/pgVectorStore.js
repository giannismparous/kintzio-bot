export class PgVectorStore {
  /**
   * @param {{ pool: import('pg').Pool }} opts
   */
  constructor(opts) {
    this.pool = opts.pool;
  }

  toVectorLiteral(embedding) {
    return `[${embedding.join(',')}]`;
  }

  async upsertChunks(chunks) {
    if (!chunks?.length) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const chunk of chunks) {
        await client.query(
          `INSERT INTO chunks (id, bot_id, source_id, ordinal, content, token_estimate, content_hash, embedding, page_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9)
           ON CONFLICT (id) DO UPDATE SET
             content = EXCLUDED.content,
             token_estimate = EXCLUDED.token_estimate,
             content_hash = EXCLUDED.content_hash,
             embedding = EXCLUDED.embedding,
             ordinal = EXCLUDED.ordinal,
             page_url = EXCLUDED.page_url`,
          [
            chunk.id,
            chunk.botId,
            chunk.sourceId,
            chunk.ordinal,
            chunk.content,
            chunk.tokenEstimate,
            chunk.contentHash,
            this.toVectorLiteral(chunk.embedding),
            chunk.pageUrl || null,
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteBySource(sourceId) {
    await this.pool.query('DELETE FROM chunks WHERE source_id = $1', [sourceId]);
  }

  async deleteByBot(botId) {
    await this.pool.query('DELETE FROM chunks WHERE bot_id = $1', [botId]);
  }

  async similaritySearch(botId, embedding, k = 6) {
    const { rows } = await this.pool.query(
      `SELECT c.id, c.source_id AS "sourceId", c.content, c.page_url AS "pageUrl",
              1 - (c.embedding <=> $2::vector) AS score,
              s.label, s.uri, s.type AS "sourceType", s.show_in_citations AS "showInCitations"
       FROM chunks c
       JOIN sources s ON s.id = c.source_id
       WHERE c.bot_id = $1 AND c.embedding IS NOT NULL
       ORDER BY c.embedding <=> $2::vector
       LIMIT $3`,
      [botId, this.toVectorLiteral(embedding), k]
    );
    return rows.map((r) => ({
      id: r.id,
      sourceId: r.sourceId,
      content: r.content,
      score: Number(r.score) || 0,
      label: r.pageUrl || r.label,
      uri: r.pageUrl || r.uri,
      sourceType: r.sourceType,
      showInCitations: r.showInCitations !== false,
    }));
  }

  async countByBot(botId) {
    const { rows } = await this.pool.query(
      'SELECT COUNT(*)::int AS n FROM chunks WHERE bot_id = $1',
      [botId]
    );
    return rows[0]?.n || 0;
  }
}
