const GREEK_SCRIPT = /[\u0370-\u03FF\u1F00-\u1FFF]/;

const ENGLISH_MARKERS =
  /\b(what|who|how|why|when|where|which|is|are|was|were|can|could|would|should|do|does|did|have|has|had|the|this|that|these|those|please|help|tell|explain|about|and|or|with|your|you|me|my|i|a|an)\b/i;

const GREEKLISH_MARKERS =
  /\b(ti|pou|pos|pws|poios|poia|poio|pote|giati|gia|kai|me|se|na|den|mou|sou|mas|sas|einai|eimai|eisai|iesai|eiste|exeis|exei|exete|thelo|thelw|thelei|auto|afto|afti|ipiresia|ipiresies|ypiresia|ypiresies|prosfero|prosfereis|voithas|voitheis|douleia|kariera|epixeirisi|etaireia|synergasia|synantisi|rantevou|kalhmera|kalispera|geia|parakalo|poso|posi|posa|mia|ena|enan|nai|oxi)\b/i;

/**
 * Detect reply language from the user's latest message only.
 * @returns {'en' | 'el'}
 */
export function detectMessageLanguage(text) {
  const message = String(text || '').trim();
  if (!message) return 'en';

  if (GREEK_SCRIPT.test(message)) return 'el';

  const lower = message.toLowerCase();

  const englishHits = (lower.match(new RegExp(ENGLISH_MARKERS.source, 'gi')) || []).length;
  const greeklishHits = (lower.match(new RegExp(GREEKLISH_MARKERS.source, 'gi')) || []).length;

  if (englishHits > 0 && greeklishHits === 0) return 'en';
  if (greeklishHits > 0 && englishHits === 0) return 'el';
  if (greeklishHits > englishHits) return 'el';
  if (englishHits > greeklishHits) return 'en';

  return 'en';
}

export function resolveReplyLanguage(message, explicitLanguage) {
  if (explicitLanguage === 'el' || explicitLanguage === 'en') return explicitLanguage;
  return detectMessageLanguage(message);
}
