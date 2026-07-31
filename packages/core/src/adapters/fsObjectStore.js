import fs from 'node:fs/promises';
import path from 'node:path';

export class FsObjectStore {
  /**
   * @param {{ rootDir: string, publicBaseUrl?: string }} opts
   */
  constructor(opts) {
    this.rootDir = path.resolve(opts.rootDir);
    this.publicBaseUrl = (opts.publicBaseUrl || '').replace(/\/$/, '');
  }

  async ensureRoot() {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  resolve(key) {
    const safe = String(key).replace(/\.\./g, '').replace(/^\/+/, '');
    return path.join(this.rootDir, safe);
  }

  async put(key, data, _contentType) {
    await this.ensureRoot();
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return key;
  }

  async get(key) {
    return fs.readFile(this.resolve(key));
  }

  async delete(key) {
    try {
      await fs.unlink(this.resolve(key));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  publicUrl(key) {
    if (!this.publicBaseUrl) return `/files/${key}`;
    return `${this.publicBaseUrl}/files/${key}`;
  }
}
