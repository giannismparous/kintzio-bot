const USER_BUBBLE_TEXT = '#faf9f5';
const ON_ACCENT = '#ffffff';

export function safeHex(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`;
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case rn:
      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
      break;
    case gn:
      h = ((bn - rn) / d + 2) / 6;
      break;
    default:
      h = ((rn - gn) / d + 4) / 6;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }) {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
  };
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio (1–21). */
export function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function nudgeLightness(hex, delta) {
  const hsl = rgbToHsl(hexToRgb(hex));
  hsl.l = Math.max(0, Math.min(1, hsl.l + delta));
  return rgbToHex(hslToRgb(hsl));
}

function ensureContrast(fg, bg, minRatio, preferAdjust = 'fg') {
  let nextFg = fg;
  let nextBg = bg;
  if (contrastRatio(nextFg, nextBg) >= minRatio) {
    return { fg: nextFg, bg: nextBg };
  }

  const fgLighter = relativeLuminance(fg) > relativeLuminance(bg);
  const fgDelta = fgLighter ? 0.012 : -0.012;
  const bgDelta = fgLighter ? -0.012 : 0.012;

  for (let step = 1; step <= 80; step += 1) {
    if (preferAdjust === 'fg' || preferAdjust === 'both') {
      nextFg = nudgeLightness(fg, fgDelta * step);
    }
    if (preferAdjust === 'bg' || preferAdjust === 'both') {
      nextBg = nudgeLightness(bg, bgDelta * step);
    }
    if (contrastRatio(nextFg, nextBg) >= minRatio) {
      return { fg: nextFg, bg: nextBg };
    }
  }

  return { fg: nextFg, bg: nextBg };
}

function pairScore(ratio, min = 4.5) {
  if (ratio >= 7) return 100;
  if (ratio >= min) return 75 + ((ratio - min) / (7 - min)) * 25;
  if (ratio >= 3) return 40 + ((ratio - 3) / (min - 3)) * 35;
  return Math.max(0, (ratio / 3) * 40);
}

function levelFromRatio(ratio, min = 4.5) {
  if (ratio >= 7) return 'aaa';
  if (ratio >= min) return 'aa';
  if (ratio >= 3) return 'aaLarge';
  return 'fail';
}

function normalizeTheme(theme = {}) {
  return {
    panelBg: safeHex(theme.panelBg, '#faf9f5'),
    accent: safeHex(theme.accent, '#d97757'),
    launcherBg: safeHex(theme.launcherBg, '#ffffff'),
    textColor: safeHex(theme.textColor, '#141413'),
  };
}

/** Pairs that mirror the live chat widget UI. */
export function getThemeContrastChecks(theme = {}) {
  const t = normalizeTheme(theme);
  return [
    {
      id: 'textOnPanel',
      labelKey: 'a11y.checkTextOnPanel',
      fg: t.textColor,
      bg: t.panelBg,
      min: 4.5,
      weight: 0.3,
      suggestKey: 'a11y.suggestTextOnPanel',
      fix: { prefer: 'fg', keys: ['textColor', 'panelBg'] },
    },
    {
      id: 'userBubble',
      labelKey: 'a11y.checkUserBubble',
      fg: USER_BUBBLE_TEXT,
      bg: t.textColor,
      min: 4.5,
      weight: 0.2,
      suggestKey: 'a11y.suggestUserBubble',
      fix: { prefer: 'bg', keys: ['textColor'] },
    },
    {
      id: 'sendButton',
      labelKey: 'a11y.checkSendButton',
      fg: ON_ACCENT,
      bg: t.accent,
      min: 4.5,
      weight: 0.15,
      suggestKey: 'a11y.suggestSendButton',
      fix: { prefer: 'bg', keys: ['accent'] },
    },
    {
      id: 'launcherText',
      labelKey: 'a11y.checkLauncherText',
      fg: t.textColor,
      bg: t.launcherBg,
      min: 4.5,
      weight: 0.15,
      suggestKey: 'a11y.suggestLauncherText',
      fix: { prefer: 'both', keys: ['textColor', 'launcherBg'] },
    },
    {
      id: 'accentOnPanel',
      labelKey: 'a11y.checkAccentOnPanel',
      fg: t.accent,
      bg: t.panelBg,
      min: 4.5,
      weight: 0.2,
      suggestKey: 'a11y.suggestAccentOnPanel',
      fix: { prefer: 'fg', keys: ['accent'] },
    },
  ];
}

export function analyzeThemeAccessibility(theme = {}) {
  const checks = getThemeContrastChecks(theme).map((check) => {
    const ratio = contrastRatio(check.fg, check.bg);
    return {
      ...check,
      ratio,
      score: pairScore(ratio, check.min),
      level: levelFromRatio(ratio, check.min),
      pass: ratio >= check.min,
    };
  });

  const score = Math.round(
    checks.reduce((sum, check) => sum + check.score * check.weight, 0),
  );

  let grade = 'poor';
  if (score >= 90) grade = 'excellent';
  else if (score >= 75) grade = 'good';
  else if (score >= 60) grade = 'fair';

  const failing = checks.filter((c) => !c.pass);

  return { score, grade, checks, failing, allPass: failing.length === 0 };
}

export function autoFixTheme(theme = {}) {
  const next = normalizeTheme(theme);

  const applyFix = (check) => {
    const result = ensureContrast(check.fg, check.bg, check.min, check.fix.prefer);
    if (check.id === 'textOnPanel') {
      next.textColor = result.fg;
      next.panelBg = result.bg;
    } else if (check.id === 'userBubble') {
      next.textColor = result.bg;
    } else if (check.id === 'sendButton') {
      next.accent = result.bg;
    } else if (check.id === 'launcherText') {
      next.textColor = result.fg;
      next.launcherBg = result.bg;
    } else if (check.id === 'accentOnPanel') {
      next.accent = result.fg;
    }
  };

  for (let round = 0; round < 12; round += 1) {
    const analysis = analyzeThemeAccessibility(next);
    if (analysis.allPass) break;
    for (const check of analysis.failing) {
      applyFix(check);
    }
  }

  return next;
}
