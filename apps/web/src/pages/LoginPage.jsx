import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { isSupabaseAuth } from '../lib/authMode.js';
import LanguageSwitcherIcon from '../components/LanguageSwitcherIcon.jsx';
import AppBrand from '../components/AppBrand.jsx';
import AppLoading from '../components/AppLoading.jsx';

export default function LoginPage() {
  const {
    ready,
    username,
    user,
    login,
    loginWithEmail,
    signUpWithEmail,
    authError,
    clearAuthError,
  } = useAuth();
  const { t } = useI18n();
  const [value, setValue] = useState(() =>
    isSupabaseAuth ? '' : localStorage.getItem('df_username') || ''
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!ready) return <AppLoading />;
  if (user) return <Navigate to="/bots" replace />;

  const submitDev = async (e) => {
    e.preventDefault();
    clearAuthError?.();
    setError('');
    const clean = value.trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(clean)) {
      setError(t('login.usernameError'));
      return;
    }
    setSubmitting(true);
    const ok = await login(clean);
    setSubmitting(false);
    if (!ok) setValue(clean);
  };

  const submitSupabase = async (e) => {
    e.preventDefault();
    clearAuthError?.();
    setError('');
    if (!email.trim() || !password) {
      setError(t('login.emailPasswordRequired'));
      return;
    }
    setSubmitting(true);
    const ok = isSignUp
      ? await signUpWithEmail(email, password)
      : await loginWithEmail(email, password);
    setSubmitting(false);
    if (!ok && isSignUp) setIsSignUp(true);
  };

  const shownError = error || authError;

  return (
    <div className="login-page">
      <form
        className="card login-card"
        onSubmit={isSupabaseAuth ? submitSupabase : submitDev}
      >
        <div className="login-card-top">
          <h1 className="brand">
            <AppBrand />
          </h1>
          <LanguageSwitcherIcon />
        </div>
        <p>{isSupabaseAuth ? t('login.taglineOnline') : t('login.tagline')}</p>

        {shownError && (
          <div className="login-error" role="alert">
            {shownError}
          </div>
        )}

        {isSupabaseAuth ? (
          <>
            <div className="field">
              <label htmlFor="email">{t('login.email')}</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError('');
                  clearAuthError?.();
                }}
                placeholder={t('login.emailPlaceholder')}
                autoFocus
                disabled={submitting}
              />
            </div>
            <div className="field">
              <label htmlFor="password">{t('login.password')}</label>
              <input
                id="password"
                type="password"
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                  clearAuthError?.();
                }}
                placeholder={t('login.passwordPlaceholder')}
                disabled={submitting}
              />
            </div>
            <button
              className="btn btn-accent"
              type="submit"
              disabled={submitting || !email.trim() || !password}
            >
              {submitting
                ? t('login.connecting')
                : isSignUp
                  ? t('login.signUp')
                  : t('login.signIn')}
            </button>
            <button
              type="button"
              className="btn btn-ghost login-toggle"
              disabled={submitting}
              onClick={() => {
                setIsSignUp((v) => !v);
                setError('');
                clearAuthError?.();
              }}
            >
              {isSignUp ? t('login.haveAccount') : t('login.needAccount')}
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="username">{t('login.username')}</label>
              <input
                id="username"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError('');
                  clearAuthError?.();
                }}
                placeholder={t('login.usernamePlaceholder')}
                autoFocus
                disabled={submitting}
              />
            </div>
            <button
              className="btn btn-accent"
              type="submit"
              disabled={submitting || !value.trim()}
            >
              {submitting ? t('login.connecting') : t('login.enter')}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
