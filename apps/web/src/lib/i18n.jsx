import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { dateLocale, translate } from './translations.js';

const STORAGE_KEY = 'df_ui_locale';

const LocaleContext = createContext(null);

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'el' ? 'el' : 'en';
  });

  const setLocale = useCallback((next) => {
    const value = next === 'el' ? 'el' : 'en';
    setLocaleState(value);
    localStorage.setItem(STORAGE_KEY, value);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === 'el' ? 'el' : 'en';
  }, [locale]);

  const t = useCallback((key, vars) => translate(locale, key, vars), [locale]);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      dateLocale: dateLocale(locale),
    }),
    [locale, setLocale, t]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useI18n must be used within LocaleProvider');
  return ctx;
}
