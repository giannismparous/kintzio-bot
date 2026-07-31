/**
 * @typedef {Object} ChunkRecord
 * @property {string} id
 * @property {string} botId
 * @property {string} sourceId
 * @property {number} ordinal
 * @property {string} content
 * @property {number} tokenEstimate
 * @property {string} contentHash
 * @property {number[]} embedding
 */

/**
 * @typedef {Object} SearchHit
 * @property {string} id
 * @property {string} sourceId
 * @property {string} content
 * @property {number} score
 * @property {string} [label]
 * @property {string} [uri]
 */

/**
 * @typedef {Object} VectorStore
 * @property {(chunks: ChunkRecord[]) => Promise<void>} upsertChunks
 * @property {(sourceId: string) => Promise<void>} deleteBySource
 * @property {(botId: string) => Promise<void>} deleteByBot
 * @property {(botId: string, embedding: number[], k?: number) => Promise<SearchHit[]>} similaritySearch
 * @property {(botId: string) => Promise<number>} countByBot
 */

/**
 * @typedef {Object} ObjectStore
 * @property {(key: string, data: Buffer|Uint8Array, contentType?: string) => Promise<string>} put
 * @property {(key: string) => Promise<Buffer>} get
 * @property {(key: string) => Promise<void>} delete
 * @property {(key: string) => string} publicUrl
 */

/**
 * @typedef {Object} Embedder
 * @property {(texts: string[]) => Promise<number[][]>} embedDocuments
 * @property {(text: string) => Promise<number[]>} embedQuery
 * @property {number} dimensions
 */

/**
 * @typedef {Object} ChatModel
 * @property {(opts: { prompt: string }) => Promise<string>} generate
 */

/**
 * @typedef {Object} UrlFetcher
 * @property {(url: string) => Promise<{ title: string, text: string, finalUrl: string }>} fetchText
 */

export {};
