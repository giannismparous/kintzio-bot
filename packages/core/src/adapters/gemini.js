import { GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiEmbedder {
  /**
   * @param {{ apiKey: string, model?: string, dimensions?: number }} opts
   */
  constructor(opts) {
    if (!opts?.apiKey) throw new Error('GEMINI_API_KEY is required');
    this.apiKey = opts.apiKey;
    this.model = opts.model || 'gemini-embedding-001';
    this.dimensions = opts.dimensions || 768;
    this.genAI = new GoogleGenerativeAI(this.apiKey);
  }

  async embedDocuments(texts) {
    const out = [];
    for (const text of texts) {
      out.push(await this._embed(text, 'RETRIEVAL_DOCUMENT'));
    }
    return out;
  }

  async embedQuery(text) {
    return this._embed(text, 'RETRIEVAL_QUERY');
  }

  async _embed(text, taskType) {
    const model = this.genAI.getGenerativeModel({ model: this.model });
    const result = await model.embedContent({
      content: { parts: [{ text: String(text || '').slice(0, 8000) }] },
      taskType,
      outputDimensionality: this.dimensions,
    });
    const values = result?.embedding?.values;
    if (!values?.length) throw new Error('Empty embedding from Gemini');
    if (values.length !== this.dimensions) {
      // Some models ignore outputDimensionality — truncate/pad defensively
      if (values.length > this.dimensions) return values.slice(0, this.dimensions);
      throw new Error(
        `Embedding dim ${values.length} != expected ${this.dimensions}`
      );
    }
    return values;
  }
}

export class GeminiChatModel {
  /**
   * @param {{ apiKey: string, model?: string }} opts
   */
  constructor(opts) {
    if (!opts?.apiKey) throw new Error('GEMINI_API_KEY is required');
    this.apiKey = opts.apiKey;
    this.model = opts.model || 'gemini-flash-lite-latest';
    this.genAI = new GoogleGenerativeAI(this.apiKey);
  }

  async generate({ prompt }) {
    const model = this.genAI.getGenerativeModel({
      model: this.model,
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.4,
      },
    });
    const result = await model.generateContent(String(prompt || ''));
    const text = result?.response?.text?.() || '';
    return String(text).trim();
  }
}
