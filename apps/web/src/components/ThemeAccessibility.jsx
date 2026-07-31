import React, { useMemo } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { analyzeThemeAccessibility, autoFixTheme } from '../lib/colorAccessibility.js';

function formatRatio(ratio) {
  return `${ratio.toFixed(2)}:1`;
}

export default function ThemeAccessibility({ theme, onApply }) {
  const { t } = useI18n();
  const analysis = useMemo(() => analyzeThemeAccessibility(theme), [theme]);

  const gradeLabel = t(`editor.a11y.grade.${analysis.grade}`);
  const canAutoFix = analysis.failing.length > 0;

  return (
    <div className="theme-a11y" aria-live="polite">
      <div className="theme-a11y-header">
        <div
          className={`theme-a11y-score theme-a11y-score--${analysis.grade}`}
          aria-label={t('editor.a11y.scoreAria', { score: analysis.score, grade: gradeLabel })}
        >
          <span className="theme-a11y-score-value">{analysis.score}</span>
          <span className="theme-a11y-score-max">/100</span>
        </div>
        <span className="theme-a11y-grade">{gradeLabel}</span>
        {canAutoFix && (
          <button
            type="button"
            className="btn btn-secondary theme-a11y-fix-btn"
            onClick={() => onApply(autoFixTheme(theme))}
          >
            {t('editor.a11y.autoFix')}
          </button>
        )}
      </div>

      <ul className="theme-a11y-checks">
        {analysis.checks.map((check) => (
          <li
            key={check.id}
            className={`theme-a11y-check theme-a11y-check--${check.level}`}
          >
            <span className="theme-a11y-check-mark" aria-hidden="true">
              {check.pass ? '✓' : '○'}
            </span>
            <span className="theme-a11y-check-label">{t(`editor.${check.labelKey}`)}</span>
            <span className="theme-a11y-check-ratio">{formatRatio(check.ratio)}</span>
            <span className={`theme-a11y-badge theme-a11y-badge--${check.level}`}>
              {t(`editor.a11y.level.${check.level}`)}
            </span>
            {!check.pass && (
              <span className="theme-a11y-suggest">{t(`editor.${check.suggestKey}`)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
