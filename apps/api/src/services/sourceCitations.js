export const DEFAULT_SOURCE_CITATIONS = {
  showSources: true,
  hideTypes: ['key_facts'],
};

export function normalizeSourceCitations(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SOURCE_CITATIONS };
  const hideTypes = Array.isArray(raw.hideTypes)
    ? raw.hideTypes.filter((t) => typeof t === 'string')
    : [];
  return {
    showSources: raw.showSources !== false,
    hideTypes,
  };
}

function isCitationTypeHidden(type, hideTypes) {
  const hide = new Set(hideTypes);
  const normalized = type === 'txt' ? 'txt' : type;
  if (hide.has(normalized)) return true;
  if ((normalized === 'pdf' || normalized === 'txt') && hide.has('file')) return true;
  return false;
}

/**
 * Build the sources list returned to the chat widget (citations UI only — RAG still uses all hits).
 */
export function buildChatSources({ hits, hasKeyFacts, sourceCitations }) {
  const settings = normalizeSourceCitations(sourceCitations);
  if (!settings.showSources) return [];

  const sources = [];
  const seen = new Set();

  if (hasKeyFacts && !isCitationTypeHidden('key_facts', settings.hideTypes)) {
    sources.push({ title: 'Trusted answers', url: null });
  }

  for (const h of hits) {
    const type = h.sourceType || 'txt';
    if (isCitationTypeHidden(type, settings.hideTypes)) continue;
    if (h.showInCitations === false) continue;

    const key = h.uri || h.label || h.sourceId;
    if (seen.has(key)) continue;
    seen.add(key);

    sources.push({
      title: h.label || 'Source',
      url: h.uri && h.uri.startsWith('http') ? h.uri : null,
    });
  }

  return sources;
}
