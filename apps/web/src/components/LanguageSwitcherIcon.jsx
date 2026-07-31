import React from 'react';
import ReactCountryFlag from 'react-country-flag';
import { useI18n } from '../lib/i18n.jsx';

const FLAG_STYLE = { width: '24px', height: '24px', borderRadius: '3px' };

/** Single flag button — same as simasiaAI_website_v3 Navbar. */
export default function LanguageSwitcherIcon({ className = '' }) {
  const { locale, setLocale, t } = useI18n();

  const toggle = () => setLocale(locale === 'el' ? 'en' : 'el');

  return (
    <button
      type="button"
      className={`language-switcher${className ? ` ${className}` : ''}`}
      onClick={toggle}
      aria-label={t('nav.switchLanguage')}
    >
      {locale === 'el' ? (
        <ReactCountryFlag countryCode="GR" svg style={FLAG_STYLE} />
      ) : (
        <ReactCountryFlag countryCode="GB" svg style={FLAG_STYLE} />
      )}
    </button>
  );
}
