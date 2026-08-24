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
        // 本项目没有 magic link / OAuth 回调，且 App.jsx 用 #studio 做模式切换，
        // 关掉 URL 探测以免 supabase-js 误消费我们自己的 hash。
        detectSessionInUrl: false,
        storageKey: 'novel-recommend.staff.auth',
      },
    })
  : null;

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
