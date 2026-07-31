import React from 'react';
import { useI18n } from '../lib/i18n.jsx';
import AppBrand from './AppBrand.jsx';

export default function AppLoading({ label }) {
  const { t } = useI18n();
  return (
    <div className="app-loading" role="status" aria-live="polite">
      <div className="app-loading-card">
        <div className="app-loading-brand">
          <AppBrand />
        </div>
        <div className="app-loading-row">
          <span className="app-loading-spinner" aria-hidden="true" />
          <span className="app-loading-label">{label || t('common.loading')}</span>
        </div>
      </div>
    </div>
  );
}
