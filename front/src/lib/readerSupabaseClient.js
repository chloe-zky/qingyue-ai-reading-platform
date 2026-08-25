import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isReaderAuthConfigured = Boolean(url && anonKey);

export const readerSupabase = isReaderAuthConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'novel-recommend.reader.auth',
      },
    })
  : null;

export async function getReaderAccessToken() {
  if (!readerSupabase) return null;
  const { data, error } = await readerSupabase.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

const READER_AUTH_ACTION = 'reader_auth_action';

export function getReaderAuthAction() {
  if (typeof window === 'undefined') return '';
  const action = new URL(window.location.href).searchParams.get(READER_AUTH_ACTION);
  return action === 'recovery' ? action : '';
}

export function getReaderRecoveryRedirectUrl() {
  const url = new URL(window.location.href);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  url.searchParams.set(READER_AUTH_ACTION, 'recovery');
  return url.toString();
}

export function clearReaderAuthCallbackUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete(READER_AUTH_ACTION);
  url.hash = '';
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
}
