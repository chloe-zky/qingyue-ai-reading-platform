import { useCallback, useEffect, useMemo, useState } from 'react';

import { readerApi } from '../lib/readerApi';
import {
  clearReaderAuthCallbackUrl,
  getReaderAuthAction,
  getReaderRecoveryRedirectUrl,
  isReaderAuthConfigured,
  readerSupabase,
} from '../lib/readerSupabaseClient';
import { ReaderAuthContext } from './ReaderAuthContext';


export default function ReaderAuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(Boolean(readerSupabase));
  const [profileError, setProfileError] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(() => getReaderAuthAction() === 'recovery');

  const refreshProfile = useCallback(async (activeSession) => {
    let resolvedSession = activeSession;
    if (resolvedSession === undefined && readerSupabase) {
      const { data } = await readerSupabase.auth.getSession();
      resolvedSession = data.session;
    }
    if (!resolvedSession) { setProfile(null); return null; }
    try {
      const next = await readerApi.me();
      setProfile(next);
      setProfileError('');
      return next;
    } catch (error) {
      setProfileError(error.detail || error.message || '读者资料读取失败');
      return null;
    }
  }, []);

  useEffect(() => {
    if (!readerSupabase) return undefined;
    let alive = true;
    readerSupabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session ?? null);
      setLoading(false);
      if (data.session) refreshProfile(data.session);
    });
    const { data: subscription } = readerSupabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      setSession(nextSession ?? null);
      // Supabase advises against calling another auth method from inside its
      // auth-state callback. Defer profile loading until the callback returns.
      if (nextSession) window.setTimeout(() => refreshProfile(nextSession), 0);
      else setProfile(null);
      setLoading(false);
    });
    return () => {
      alive = false;
      subscription.subscription.unsubscribe();
    };
  }, [refreshProfile]);

  const signIn = useCallback(async (email, password) => {
    if (!readerSupabase) throw new Error('读者登录环境尚未配置');
    const { data, error } = await readerSupabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setSession(data.session);
    await refreshProfile(data.session);
    return data;
  }, [refreshProfile]);

  const signUp = useCallback(async (displayName, email, password) => {
    if (!readerSupabase) throw new Error('读者注册环境尚未配置');
    const { data, error } = await readerSupabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName.trim() },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) throw error;
    if (data.session) {
      setSession(data.session);
      await refreshProfile(data.session);
    }
    return { ...data, needsConfirmation: !data.session };
  }, [refreshProfile]);

  const signOut = useCallback(async () => {
    if (readerSupabase) await readerSupabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }, []);

  const requestPasswordReset = useCallback(async (email) => {
    if (!readerSupabase) throw new Error('读者登录环境尚未配置');
    const { error } = await readerSupabase.auth.resetPasswordForEmail(email, {
      redirectTo: getReaderRecoveryRedirectUrl(),
    });
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (password) => {
    if (!readerSupabase) throw new Error('读者登录环境尚未配置');
    const { data, error } = await readerSupabase.auth.updateUser({ password });
    if (error) throw error;
    setRecoveryMode(false);
    clearReaderAuthCallbackUrl();
    return data;
  }, []);

  const cancelPasswordRecovery = useCallback(async () => {
    if (readerSupabase) await readerSupabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setRecoveryMode(false);
    clearReaderAuthCallbackUrl();
  }, []);

  const updateProfile = useCallback(async (displayName) => {
    const next = await readerApi.updateMe({ display_name: displayName });
    setProfile(next);
    return next;
  }, []);

  const updatePersonalization = useCallback(async (enabled) => {
    const next = await readerApi.updateMe({ personalization_enabled: enabled });
    setProfile(next);
    return next;
  }, []);

  const value = useMemo(() => ({
    configured: isReaderAuthConfigured,
    session, profile, profileError, loading, recoveryMode,
    signIn, signUp, signOut, requestPasswordReset, updatePassword, cancelPasswordRecovery,
    refreshProfile, updateProfile, updatePersonalization,
  }), [
    session, profile, profileError, loading, recoveryMode,
    signIn, signUp, signOut, requestPasswordReset, updatePassword, cancelPasswordRecovery,
    refreshProfile, updateProfile, updatePersonalization,
  ]);

  return <ReaderAuthContext.Provider value={value}>{children}</ReaderAuthContext.Provider>;
}
