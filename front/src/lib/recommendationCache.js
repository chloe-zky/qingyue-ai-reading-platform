// recommendationCache.js — 读者推荐结果的模块级缓存。
//
// 解决两个重复请求的问题：
//   1. HomeTab（空偏好）与 ReaderPage（已保存偏好）各自发 /api/recommendations，
//      首页 ⇄ 发现 来回切换会反复打网络。
//   2. 并发调用（预拉 + 页面挂载同时触发）会同时发出多个相同请求。
//
// 缓存键 = 受众 + 规范化后的三组偏好：
//   · 受众必须进键。登录读者与匿名拿到的推荐不同，混用会把别人的结果发给错的人。
//   · 偏好规范化后进键。['古风','现代'] 与 ['现代','古风',''] 是同一次请求，
//     不规范化会因为顺序或空串产生无谓的缓存穿透。
//
// 失败不写缓存：下次调用仍会重试，不会把一次网络抖动固化 60 秒。

import { apiFetch } from './apiClient';

const TTL_MS = 60_000;
const PREF_KEYS = ['setting_tags', 'story_tone_tags', 'relationship_core_tags'];

/** key -> { at, value } */
const entries = new Map();
/** key -> Promise，用于复用在途请求 */
const inFlight = new Map();
/** audience -> generation；登出时让已经发出的旧请求失去写缓存资格。 */
const generations = new Map();

function generationOf(audience) {
  const target = audienceOf(audience);
  if (!generations.has(target)) generations.set(target, 0);
  return generations.get(target);
}

function normalizeList(list) {
  const cleaned = (Array.isArray(list) ? list : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
  return [...new Set(cleaned)].sort();
}

/** 规范化三组偏好；同时就是发给后端的请求体（字段名不变）。 */
export function normalizePrefs(prefs = {}) {
  const out = {};
  for (const key of PREF_KEYS) out[key] = normalizeList(prefs[key]);
  return out;
}

export function audienceOf(readerId) {
  return readerId || 'anonymous';
}

function cacheKey(audience, normalized) {
  return JSON.stringify([audienceOf(audience), ...PREF_KEYS.map((k) => normalized[k])]);
}

function isFresh(entry) {
  return Boolean(entry) && Date.now() - entry.at < TTL_MS;
}

/**
 * 同步读缓存。命中且未过期才返回，否则 null。
 * 调用方可以据此跳过 loading 态，直接渲染结果。
 */
export function peekRecommendations({ audience, prefs } = {}) {
  const entry = entries.get(cacheKey(audience, normalizePrefs(prefs)));
  return isFresh(entry) ? entry.value : null;
}

async function requestRecommendations(key, audience, normalized) {
  const generation = generationOf(audience);
  const task = (async () => {
    try {
      const data = await apiFetch('/api/recommendations', {
        method: 'POST',
        // optional-reader：有读者令牌就带上，没有则按匿名请求，不会抛 401。
        auth: 'optional-reader',
        body: normalized,
      });
      const value = {
        results: Array.isArray(data?.results) ? data.results : [],
        requestId: data?.request_id || '',
        // 后端在没有精确匹配、用接近候选补位时会给 match_type/notice；
        // 缓存原样带上，匿名路径才能显示同一句提示。
        matchType: data?.match_type || '',
        notice: data?.notice || '',
      };
      if (generationOf(audience) === generation) {
        entries.set(key, { at: Date.now(), value });
      }
      return value;
    } finally {
      if (inFlight.get(key) === task) inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  return task;
}

/**
 * 取推荐。新鲜缓存直接返回；有在途请求则复用同一个 Promise；否则发起请求。
 * @returns {Promise<{ results: Array, requestId: string }>}
 */
export async function getRecommendations({ audience, prefs } = {}) {
  const normalized = normalizePrefs(prefs);
  const key = cacheKey(audience, normalized);

  const cached = entries.get(key);
  if (isFresh(cached)) return cached.value;

  const pending = inFlight.get(key);
  if (pending) return pending;

  return requestRecommendations(key, audience, normalized);
}

/**
 * 强制刷新：忽略 TTL 重新请求并覆盖缓存。已有在途请求时复用，避免打爆后端。
 * 供「后台刷新」场景使用；调用方通常不 await。
 */
export async function refreshRecommendations({ audience, prefs } = {}) {
  const normalized = normalizePrefs(prefs);
  const key = cacheKey(audience, normalized);
  const pending = inFlight.get(key);
  if (pending) return pending;
  return requestRecommendations(key, audience, normalized);
}

/**
 * 失效缓存。传 audience 只清该受众（登出/换账号时用），不传则全清。
 * 无法取消已经发出的 HTTP 请求，但会让旧请求失去写缓存资格；同一受众的新请求
 * 无需等待旧 Promise，可立即开始。
 */
export function invalidateRecommendations(audience) {
  if (audience === undefined) {
    for (const target of generations.keys()) {
      generations.set(target, generationOf(target) + 1);
    }
    entries.clear();
    inFlight.clear();
    return;
  }
  const target = audienceOf(audience);
  generations.set(target, generationOf(target) + 1);
  for (const key of [...entries.keys()]) {
    // 键是 JSON 数组，受众在第 0 位。
    try {
      if (JSON.parse(key)[0] === target) entries.delete(key);
    } catch { /* 键一定是我们自己写的，解析失败就跳过 */ }
  }
  for (const key of [...inFlight.keys()]) {
    try {
      if (JSON.parse(key)[0] === target) inFlight.delete(key);
    } catch { /* 同上 */ }
  }
}
