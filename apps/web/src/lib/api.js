import { getApiAuth } from './apiAuth.js';
import { isSupabaseAuth } from './authMode.js';

const DEFAULT_API_URL = import.meta.env.PROD
  ? window.location.origin
  : 'http://localhost:8787';
const API_URL = (import.meta.env.VITE_API_URL || DEFAULT_API_URL).replace(/\/$/, '');

export function getApiUrl() {
  return API_URL;
}

function friendlyNetworkError(err) {
  const msg = String(err?.message || '');
  if (
    err?.name === 'TypeError' ||
    /failed to fetch|load failed|networkerror|network request failed/i.test(msg)
  ) {
    return isSupabaseAuth
      ? 'Cannot reach the API. The server may be waking up — wait a few seconds and refresh.'
      : 'Cannot reach API at localhost:8787. Run npm run dev:api (or npm run dev).';
  }
  return msg || 'Request failed';
}

export async function api(path, { method = 'GET', body, username, token, formData, signal } = {}) {
  const headers = {};
  const auth = getApiAuth();
  const resolvedToken = token ?? (await auth.getAccessToken?.());
  const resolvedUsername = isSupabaseAuth
    ? null
    : (username ?? auth.username);

  if (resolvedToken) headers.Authorization = `Bearer ${resolvedToken}`;
  if (resolvedUsername) headers['X-Dev-User'] = resolvedUsername;

  if (isSupabaseAuth && !resolvedToken && !path.startsWith('/auth/config') && !path.startsWith('/public')) {
    const err = new Error('Not signed in');
    err.status = 401;
    throw err;
  }

  let payload = body;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: payload,
      signal,
    });
  } catch (err) {
    const networkErr = new Error(friendlyNetworkError(err));
    networkErr.cause = err;
    throw networkErr;
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }

  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
