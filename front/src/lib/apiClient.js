// apiClient.js — 内部工作台统一 API 客户端（Bearer）。
//
// 后端契约（backend/app/utils/auth.py + routers/internal.py）：
//   Authorization: Bearer <supabase access_token>
//   401 缺凭证 / 凭证失效      → 会话已死，清理并回登录
//   403 无内部权限 / 账号禁用 / 角色不足 → 会话有效但无权，保留会话、停在无权页
//   503 员工权限服务不可用      → 可重试，不清会话
//
// 把这三档语义收在 ApiError 上，调用方只判断 err.isUnauthorized / isForbidden /
// isUnavailable，不再各自解析 status，避免「403 也把人踢下线」这类错配。

import { getAccessToken } from './supabaseClient';

/** 未显式配置时按当前主机名推断，兼容手机热点/局域网调试。 */
const API_BASE =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') ||
  `http://${window.location.hostname}:8000`;

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
  get isUnauthorized() { return this.status === 401; }
  get isForbidden() { return this.status === 403; }
  get isUnavailable() { return this.status === 503; }
  /** 请求根本没发出去（断网 / 后端没起）时 status 为 0。 */
  get isNetworkError() { return this.status === 0; }
}

// ── 401 广播：任何一处请求发现会话已死，都通知 Provider 统一登出 ──
const unauthorizedListeners = new Set();

/** 注册会话失效回调；返回取消订阅函数。 */
export function onUnauthorized(listener) {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

function broadcastUnauthorized() {
  for (const listener of unauthorizedListeners) {
    try {
      listener();
    } catch {
      // 单个监听者出错不应影响其他监听者与本次请求的错误传播。
    }
  }
}

// FastAPI 的 detail 可能是字符串，也可能是 422 的校验数组。
function readDetail(payload, fallback) {
  const detail = payload?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0];
    if (typeof first?.msg === 'string') return first.msg;
  }
  return fallback;
}

/**
 * 发一个带 Bearer 的请求。
 *
 * @param {string} path              以 / 开头的接口路径
 * @param {object} [options]
 * @param {string} [options.method]  默认 GET
 * @param {any}    [options.body]    普通对象 → JSON；FormData → 原样发送（不设 Content-Type）
 * @param {AbortSignal} [options.signal]
 * @param {boolean} [options.auth]   默认 true；false 时不附带凭证（公开接口）
 * @returns 解析后的响应体；204 返回 null
 * @throws {ApiError}
 */
export async function apiFetch(path, options = {}) {
  const { method = 'GET', body, signal, auth = true } = options;

  const headers = {};
  let payload;
  if (body instanceof FormData) {
    // 交给浏览器自动带 multipart boundary，手动设置反而会坏。
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  if (auth) {
    const token = await getAccessToken();
    if (!token) {
      broadcastUnauthorized();
      throw new ApiError(401, '登录已失效，请重新登录');
    }
    headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload, signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError(0, '无法连接服务器，请检查网络或后端是否已启动');
  }

  if (res.status === 204) return null;

  let data;
  try {
    data = await res.json();
  } catch {
    data = null; // 空响应体或非 JSON——错误分支仍能靠状态码给出兜底文案
  }

  if (!res.ok) {
    const error = new ApiError(res.status, readDetail(data, `请求失败（${res.status}）`));
    if (error.isUnauthorized) broadcastUnauthorized();
    throw error;
  }
  return data;
}

export const api = {
  get: (path, options) => apiFetch(path, { ...options, method: 'GET' }),
  post: (path, body, options) => apiFetch(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => apiFetch(path, { ...options, method: 'PATCH', body }),
  del: (path, options) => apiFetch(path, { ...options, method: 'DELETE' }),
};

export { API_BASE };
