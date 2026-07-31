import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { api } from './api.js';
import { setApiAuth } from './apiAuth.js';
import { isSupabaseAuth } from './authMode.js';
import { assertSupabaseClient } from './supabase.js';

const AuthContext = createContext(null);
const STORAGE_KEY = 'df_username';

async function fetchMe({ username, token }) {
  return api('/auth/me', { username, token });
}

export function AuthProvider({ children }) {
  const [username, setUsername] = useState(() =>
    isSupabaseAuth ? '' : localStorage.getItem(STORAGE_KEY) || ''
  );
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState('');
  const [accessToken, setAccessToken] = useState(null);

  const getAccessToken = useCallback(async () => {
    if (!isSupabaseAuth) return null;
    if (accessToken) return accessToken;
    try {
      const client = assertSupabaseClient();
      const { data } = await client.auth.getSession();
      return data.session?.access_token || null;
    } catch {
      return null;
    }
  }, [accessToken]);

  useEffect(() => {
    setApiAuth({
      username: isSupabaseAuth ? null : username || null,
      getAccessToken: isSupabaseAuth ? getAccessToken : null,
    });
  }, [username, accessToken, getAccessToken]);

  const loginDev = useCallback(async (clean) => {
    const data = await api('/auth/dev-login', {
      method: 'POST',
      body: { username: clean },
      username: clean,
    });
    return data.user;
  }, []);

  const syncSupabaseSession = useCallback(async (session) => {
    if (!session?.access_token) {
      setAccessToken(null);
      setUser(null);
      return;
    }
    setAccessToken(session.access_token);
    const data = await fetchMe({ token: session.access_token });
    setUser(data.user);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootDev() {
      if (!username) {
        setUser(null);
        setReady(true);
        return;
      }
      setAuthError('');
      try {
        const nextUser = await loginDev(username);
        if (!cancelled) setUser(nextUser);
      } catch (err) {
        if (!cancelled) {
          setUser(null);
          setAuthError(
            err?.message?.includes('fetch') || err?.name === 'TypeError'
              ? 'Cannot reach API at localhost:8787. Run npm run dev:api (or npm run dev).'
              : err.message || 'Login failed'
          );
          if (err?.status && err.status >= 400 && err.status < 500) {
            localStorage.removeItem(STORAGE_KEY);
            setUsername('');
          }
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    async function bootSupabase() {
      const client = assertSupabaseClient();
      setAuthError('');
      try {
        const { data } = await client.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          await syncSupabaseSession(data.session);
        } else {
          setUser(null);
          setAccessToken(null);
        }
      } catch (err) {
        if (!cancelled) {
          setUser(null);
          setAccessToken(null);
          setAuthError(err.message || 'Could not restore session');
        }
      } finally {
        if (!cancelled) setReady(true);
      }

      const { data: listener } = client.auth.onAuthStateChange(async (_event, session) => {
        if (cancelled) return;
        try {
          await syncSupabaseSession(session);
        } catch (err) {
          setUser(null);
          setAuthError(err.message || 'Session expired');
        }
      });

      return () => listener.subscription.unsubscribe();
    }

    if (isSupabaseAuth) {
      const cleanupPromise = bootSupabase();
      return () => {
        cancelled = true;
        cleanupPromise.then((cleanup) => cleanup?.());
      };
    }

    bootDev();
    return () => {
      cancelled = true;
    };
  }, [username, loginDev, syncSupabaseSession]);

  const value = useMemo(
    () => ({
      ready,
      user,
      username: user?.username || username,
      authMode: isSupabaseAuth ? 'supabase' : 'dev',
      authError,
      clearAuthError: () => setAuthError(''),
      login: async (name) => {
        if (isSupabaseAuth) return false;
        const clean = String(name || '')
          .trim()
          .toLowerCase();
        setAuthError('');
        try {
          const nextUser = await loginDev(clean);
          localStorage.setItem(STORAGE_KEY, clean);
          setUsername(clean);
          setUser(nextUser);
          setReady(true);
          return true;
        } catch (err) {
          setAuthError(
            err?.message?.includes('fetch') || err?.name === 'TypeError'
              ? 'Cannot reach API at localhost:8787. Run npm run dev:api (or npm run dev).'
              : err.message || 'Login failed'
          );
          return false;
        }
      },
      loginWithEmail: async (email, password) => {
        const client = assertSupabaseClient();
        setAuthError('');
        const { data, error } = await client.auth.signInWithPassword({
          email: String(email || '').trim(),
          password: String(password || ''),
        });
        if (error) {
          setAuthError(error.message);
          return false;
        }
        await syncSupabaseSession(data.session);
        setReady(true);
        return true;
      },
      signUpWithEmail: async (email, password) => {
        const client = assertSupabaseClient();
        setAuthError('');
        const { data, error } = await client.auth.signUp({
          email: String(email || '').trim(),
          password: String(password || ''),
        });
        if (error) {
          setAuthError(error.message);
          return false;
        }
        if (!data.session) {
          setAuthError('Check your email to confirm your account, then sign in.');
          return false;
        }
        await syncSupabaseSession(data.session);
        setReady(true);
        return true;
      },
      logout: async () => {
        if (isSupabaseAuth) {
          const client = assertSupabaseClient();
          await client.auth.signOut();
        } else {
          localStorage.removeItem(STORAGE_KEY);
          setUsername('');
        }
        setUser(null);
        setAccessToken(null);
        setAuthError('');
      },
    }),
    [ready, user, username, authError, loginDev, syncSupabaseSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
