export const AUTH_MODE = (import.meta.env.VITE_AUTH_MODE || 'dev').toLowerCase() === 'supabase'
  ? 'supabase'
  : 'dev';

export const isSupabaseAuth = AUTH_MODE === 'supabase';
