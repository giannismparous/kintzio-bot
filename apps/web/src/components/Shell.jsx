import React from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import LanguageSwitcherIcon from './LanguageSwitcherIcon.jsx';
import AppBrand from './AppBrand.jsx';

export default function Shell() {
  const { username, logout } = useAuth();
  const { t } = useI18n();

  return (
    <div className="app-shell">
      <header className="shell-bar">
        <Link to="/bots" className="brand">
          <AppBrand />
        </Link>

        <div className="shell-user">
          <LanguageSwitcherIcon />
          <span className="shell-username">@{username}</span>
          <button type="button" className="shell-switch" onClick={logout}>
            {t('nav.logout')}
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
