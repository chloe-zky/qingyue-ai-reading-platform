// supabaseClient.js — 内部工作台的 Supabase Auth 客户端（唯一实例）。
//
// 只做「登录 / 会话 / 刷新 access_token」这一件事：
// 业务数据一律走 FastAPI（见 lib/apiClient.js），前端不直接查库，
// 这样 RLS 与后端 RBAC 只有一处权威，不会出现两套权限判断。
//
// 前端只持有 anon public key（受 RLS 约束）；service key 属于后端。

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** 环境变量缺失时为 false —— 界面据此提示「未配置」而不是抛白屏。 */
export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // 邀请与找回密码使用 Supabase implicit flow。客户端必须先消费 URL
        // fragment 中的会话，StaffPasswordSetup 才能调用 updateUser 设置新密码。
        detectSessionInUrl: true,
        storageKey: 'novel-recommend.staff.auth',
      },
    })
  : null;

const AUTH_ACTIONS = new Set(['invite', 'recovery']);

/** 当前 URL 是否来自员工邀请 / 密码重置邮件。 */
export function getStaffAuthAction() {
  if (typeof window === 'undefined') return null;
  const action = new URLSearchParams(window.location.search).get('auth_action');
  return AUTH_ACTIONS.has(action) ? action : null;
}

/**
 * 生成员工认证邮件的前端回跳地址。
 * 保留当前 origin，开发时可同时兼容 localhost、127.0.0.1 与手机热点地址；
 * 对应 origin 必须同时加入 Supabase Auth 的 Redirect URLs allow list。
 */
export function getStaffAuthRedirectUrl(action) {
  if (typeof window === 'undefined') return '';
  if (!AUTH_ACTIONS.has(action)) throw new Error('不支持的员工认证动作');
  const target = new URL(window.location.origin);
  target.pathname = '/studio/login';
  target.searchParams.set('auth_action', action);
  return target.toString();
}

/** 完成或放弃认证动作后移除 token、错误片段与临时查询参数。 */
export function clearStaffAuthCallbackUrl() {
  if (typeof window === 'undefined') return;
  window.history.replaceState({}, '', window.location.pathname);
}

/**
 * 取当前可用的 access_token；supabase-js 会在临近过期时自动续期。
 * 未配置或未登录时返回 null（调用方据此走匿名分支，不抛错）。
 */
export async function getAccessToken() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}
