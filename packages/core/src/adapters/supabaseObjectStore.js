/**
 * Object storage via Supabase Storage (production).
 * Implements the same interface as FsObjectStore.
 */
export class SupabaseObjectStore {
  /**
   * @param {{ client: import('@supabase/supabase-js').SupabaseClient, bucket: string, publicBaseUrl?: string }} opts
   */
  constructor(opts) {
    this.client = opts.client;
    this.bucket = opts.bucket;
    this.publicBaseUrl = (opts.publicBaseUrl || '').replace(/\/$/, '');
  }

  async put(key, data, contentType) {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const { error } = await this.client.storage.from(this.bucket).upload(key, body, {
      upsert: true,
      contentType: contentType || 'application/octet-stream',
    });
    if (error) throw new Error(error.message);
    return key;
  }

  async get(key) {
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error) throw new Error(error.message);
    return Buffer.from(await data.arrayBuffer());
  }

  async delete(key) {
    const { error } = await this.client.storage.from(this.bucket).remove([key]);
    if (error) throw new Error(error.message);
  }

  publicUrl(key) {
    const { data } = this.client.storage.from(this.bucket).getPublicUrl(key);
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl}/storage/v1/object/public/${this.bucket}/${key}`;
    }
    return data.publicUrl;
  }
}
