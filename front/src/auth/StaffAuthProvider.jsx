// StaffAuthProvider.jsx — 内部工作台会话的唯一持有者。
//
// 职责：Supabase Auth 登录/登出/自动续期 → 用 access_token 换取 GET /api/internal/me
// 的角色身份 → 以状态机形式暴露给下游（见 staffAuth.js 的 AUTH_STATUS）。
//
// 两个刻意的设计：
// 1. 角色只认后端。前端不查 staff_profiles，避免 RLS 与后端 RBAC 出现两套判断。
// 2. 403 不等于登出。没有内部权限 / 账号被禁用时保留 Supabase 会话，停在无权页
//    并给出「退出」入口；只有 401（凭证失效）才清会话。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { api, ApiError, onUnauthorized } from '../lib/apiClient';
import { AUTH_STATUS, StaffAuthContext } from './staffAuth';

export default function StaffAuthProvider({ children }) {
  const [status, setStatus] = useState(
    isSupabaseConfigured ? AUTH_STATUS.LOADING : AUTH_STATUS.UNCONFIGURED
  );
  const [staff, setStaff] = useState(null);
  const [error, setError] = useState('');

  // 登录/登出/自动续期可能密集触发；只认最后一次请求的结果，丢弃过期回包。
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /** 用当前会话换取员工身份；无会话则直接归为匿名。 */
  const resolveStaff = useCallback(async () => {
    const runId = ++runIdRef.current;
    const settle = (next) => {
      if (!mountedRef.current || runId !== runIdRef.current) return false;
      next();
      return true;
    };

    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      settle(() => {
        setStaff(null);
        setError('');
        setStatus(AUTH_STATUS.ANONYMOUS);
      });
      return;
    }

    try {
      const me = await api.get('/api/internal/me');
      settle(() => {
        setStaff(me);
        setError('');
        setStatus(AUTH_STATUS.AUTHENTICATED);
      });
    } catch (e) {
      const apiError = e instanceof ApiError ? e : null;
      settle(() => {
        setStaff(null);
        setError(apiError?.detail || '无法确认账号权限');
        if (apiError?.isForbidden) setStatus(AUTH_STATUS.FORBIDDEN);
        else if (apiError?.isUnavailable || apiError?.isNetworkError) setStatus(AUTH_STATUS.UNAVAILABLE);
        else setStatus(AUTH_STATUS.ANONYMOUS); // 401：凭证已失效
      });
    }
  }, []);

  // 启动校验 + 订阅 Supabase 会话变化（含 token 自动续期与跨标签页登出）。
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    resolveStaff();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      // TOKEN_REFRESHED 不改变身份，重复拉 /me 只是噪音。
      if (event === 'TOKEN_REFRESHED') return;
      resolveStaff();
    });
    return () => sub.subscription.unsubscribe();
  }, [resolveStaff]);

  const signOut = useCallback(async () => {
    runIdRef.current++; // 作废在途的 /me 回包，避免登出后又被写回身份
    if (isSupabaseConfigured) await supabase.auth.signOut();
    if (!mountedRef.current) return;
    setStaff(null);
    setError('');
    setStatus(isSupabaseConfigured ? AUTH_STATUS.ANONYMOUS : AUTH_STATUS.UNCONFIGURED);
  }, []);

  // 任一请求撞上 401：会话已死，统一清理。
  useEffect(() => onUnauthorized(() => { signOut(); }), [signOut]);

  /** 邮箱密码登录。成功返回 true；失败返回 false 并把原因写入 error。 */
  const signIn = useCallback(async (email, password) => {
    if (!isSupabaseConfigured) {
      setError('前端未配置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
      return false;
    }
    setError('');
    setStatus(AUTH_STATUS.LOADING);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: (email || '').trim(),
      password: password || '',
    });
    if (signInError) {
      if (!mountedRef.current) return false;
      setError(signInError.message || '登录失败，请检查邮箱与密码');
      setStatus(AUTH_STATUS.ANONYMOUS);
      return false;
    }
    // onAuthStateChange 也会触发一次；resolveStaff 用 runId 保证只认最后一次。
    await resolveStaff();
    return true;
  }, [resolveStaff]);

  const value = useMemo(() => ({
    status,
    staff,
    error,
    role: staff?.role ?? null,
    isAuthenticated: status === AUTH_STATUS.AUTHENTICATED,
    signIn,
    signOut,
    retry: resolveStaff,
  }), [status, staff, error, signIn, signOut, resolveStaff]);

  return <StaffAuthContext.Provider value={value}>{children}</StaffAuthContext.Provider>;
}
