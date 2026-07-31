import crypto from 'node:crypto';

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'bot';
}

export function normalizeUrl(url) {
  let raw = String(url || '').trim();
  if (!raw) throw new Error('invalid_url');
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
    raw = `https://${raw}`;
  }
  const u = new URL(raw);
  if (!/^https?:$/i.test(u.protocol)) {
    throw new Error('invalid_url');
  }
  u.hash = '';
  if (u.pathname.endsWith('/') && u.pathname.length > 1) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.toString();
}

export function urlDisplayLabel(url) {
  try {
    let raw = String(url || '')
      .trim()
      .replace(/^Site:\s*/i, '');
    if (!raw) return '';
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) raw = `https://${raw}`;
    const u = new URL(raw);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return String(url || '')
      .replace(/^Site:\s*/i, '')
      .replace(/^https?:\/\//i, '')
      .split('/')[0];
  }
}

export function fileDisplayLabel(name) {
  const s = String(name || '').trim();
  if (!s) return 'File';
  const parts = s.split(/[/\\]/);
  return parts[parts.length - 1] || s;
}

export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

/**
 * Split text into overlapping chunks by character budget.
 */
export function chunkText(text, { maxChars = 1200, overlap = 150 } = {}) {
  const cleaned = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned) return [];

  const chunks = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(cleaned.length, start + maxChars);
    if (end < cleaned.length) {
      const slice = cleaned.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '), slice.lastIndexOf(' '));
      if (lastBreak > maxChars * 0.4) {
        end = start + lastBreak + 1;
      }
    }
    const part = cleaned.slice(start, end).trim();
    if (part) chunks.push(part);
    if (end >= cleaned.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}
