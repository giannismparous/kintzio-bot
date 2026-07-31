import React from 'react';
import { useI18n } from '../lib/i18n.jsx';

export default function LanguageToggle({ className = '' }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <div
      className={`scrape-mode-toggle language-toggle${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={t('common.platformLanguage')}
    >
      <button
        type="button"
        className={`mode-chip${locale === 'en' ? ' active' : ''}`}
        onClick={() => setLocale('en')}
      >
        {t('common.english')}
      </button>
      <button
        type="button"
        className={`mode-chip${locale === 'el' ? ' active' : ''}`}
        onClick={() => setLocale('el')}
      >
        {t('common.greek')}
      </button>
    </div>
  );
}
