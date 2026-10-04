import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { clearHomePickCache, primeHomePick } from '../homePickCache';
import { clearDailyPreferenceCache, primeDailyPreference } from '../lib/dailyPreferenceApi';
import { preloadImage } from '../lib/imagePreload';
import { readerApi } from '../lib/readerApi';
import { invalidateRecommendations } from '../lib/recommendationCache';
import {
  clearReaderAuthCallbackUrl,
  getReaderAuthAction,
  getReaderRecoveryRedirectUrl,
  isReaderAuthConfigured,
  readerSupabase,
} from '../lib/readerSupabaseClient';
import { ReaderAuthContext } from './ReaderAuthContext';


function primeReaderExperience(activeSession) {
  const userId = activeSession?.user?.id;
  if (!userId) return;
  primeHomePick(userId);
  primeDailyPreference(userId);
}

export default function ReaderAuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(Boolean(readerSupabase));
  const [profileError, setProfileError] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(() => getReaderAuthAction() === 'recovery');
  const profileRequestRef = useRef({ userId: '', promise: null });

  const refreshProfile = useCallback(async (activeSession) => {
    let resolvedSession = activeSession;
    if (resolvedSession === undefined && readerSupabase) {
      const { data } = await readerSupabase.auth.getSession();
      resolvedSession = data.session;
    }
    if (!resolvedSession) {
      profileRequestRef.current = { userId: '', promise: null };
      setProfile(null);
      return null;
    }
    const userId = resolvedSession.user?.id || '';
    if (profileRequestRef.current.userId === userId && profileRequestRef.current.promise) {
      return profileRequestRef.current.promise;
    }

    const task = (async () => {
      try {
        const next = await readerApi.me();
        if (profileRequestRef.current.userId === userId) {
          setProfile(next);
          setProfileError('');
        }
        return next;
      } catch (error) {
        if (profileRequestRef.current.userId === userId) {
          setProfileError(error.detail || error.message || '读者资料读取失败');
        }
        return null;
      } finally {
        if (profileRequestRef.current.promise === task) {
          profileRequestRef.current = { userId, promise: null };
        }
      }
    })();
    profileRequestRef.current = { userId, promise: task };
    return task;
  }, []);

  useEffect(() => {
    if (!readerSupabase) return undefined;
    let alive = true;
    readerSupabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session ?? null);
      setLoading(false);
      if (data.session) {
        primeReaderExperience(data.session);
        void refreshProfile(data.session);
      }
    });
    const { data: subscription } = readerSupabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      setSession(nextSession ?? null);
      // Supabase advises against calling another auth method from inside its
      // auth-state callback. Defer profile loading until the callback returns.
      if (nextSession) {
        primeReaderExperience(nextSession);
        if (['INITIAL_SESSION', 'SIGNED_IN', 'USER_UPDATED'].includes(event)) {
          window.setTimeout(() => { void refreshProfile(nextSession); }, 0);
        }
      }
      else setProfile(null);
      setLoading(false);
    });
    return () => {
      alive = false;
      subscription.subscription.unsubscribe();
    };
  }, [refreshProfile]);

  // 头像预热。profile 一到手就把图下下来，不等「我的」挂载——原来那张图的
  // 下载是被 MineTab 的第一次渲染触发的，所以每次进「我的」都要现等一次网络，
  // 头像先是空的、隔一会儿才浮出来。
  //
  // 放在这里而不是 UserApp：登录、刷新恢复会话、换头像后刷新 profile 都会经过
  // 这一处，是唯一能覆盖全部入口的地方。同一个 url 重复调用会复用同一个
  // promise，profile 反复刷新也不会重复发请求。
  useEffect(() => {
    const url = profile?.avatar_url;
    if (url) preloadImage(url);
  }, [profile?.avatar_url]);

  const signIn = useCallback(async (email, password) => {
    if (!readerSupabase) throw new Error('读者登录环境尚未配置');
    const { data, error } = await readerSupabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setSession(data.session);
    primeReaderExperience(data.session);
    void refreshProfile(data.session);
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
      primeReaderExperience(data.session);
      void refreshProfile(data.session);
    }
    return { ...data, needsConfirmation: !data.session };
  }, [refreshProfile]);

  const signOut = useCallback(async () => {
    const userId = session?.user?.id || '';
    if (readerSupabase) await readerSupabase.auth.signOut();
    profileRequestRef.current = { userId: '', promise: null };
    clearDailyPreferenceCache();
    if (userId) {
      clearHomePickCache(userId);
      invalidateRecommendations(userId);
    }
    setSession(null);
    setProfile(null);
  }, [session?.user?.id]);

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
