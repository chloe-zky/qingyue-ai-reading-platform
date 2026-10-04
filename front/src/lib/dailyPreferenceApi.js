// dailyPreferenceApi.js — 发现页「今日偏好」的服务端状态。
//
// 服务端是唯一事实来源：业务日按 Asia/Shanghai 由后端算，浏览器时钟不参与
// 判断「今天有没有选过」。这里只做两件事：
//   1. 一次往返同时拿到「今日状态 + 推荐结果」，避免先查状态再查推荐的瀑布
//   2. 极短的进程内缓存，让首页 ⇄ 发现 来回切换不必每次重打接口
//
// 缓存语义刻意保守：
//   - 只缓存成功结果，失败不写（失败必须显示重试，不能被当成「今天没选过」）
//   - 60s TTL，跨北京时间零点最多滞后一分钟
//   - PUT 直接写穿缓存，「重选今日偏好」后不会读到旧状态
//   - 受众隔离：换账号即失效，绝不把上一位读者的当日选择发给下一位

import { apiFetch } from './apiClient';

const DAILY_PATH = '/api/recommendations/daily';
const STATE_TTL_MS = 60_000;

/** { at, audience, value } | null */
let entry = null;
const inFlightByAudience = new Map();
let cacheGeneration = 0;

function audienceOf(userId) {
  return userId || '';
}

function store(userId, value) {
  entry = { at: Date.now(), audience: audienceOf(userId), value };
  return value;
}

function isFresh(userId) {
  return Boolean(entry)
    && entry.audience === audienceOf(userId)
    && Date.now() - entry.at < STATE_TTL_MS;
}

/** 同步读已缓存的今日状态；没有则 null。用于首屏初值，避免加载态闪一下。 */
export function peekDailyPreference(userId) {
  return isFresh(userId) ? entry.value : null;
}

/** 读取今日状态（含推荐结果）。失败向上抛，由调用方进入可重试错误态。 */
export async function getDailyPreference(userId) {
  if (isFresh(userId)) return entry.value;
  const audience = audienceOf(userId);
  const pending = inFlightByAudience.get(audience);
  if (pending) return pending;
  const generation = cacheGeneration;

  const task = apiFetch(DAILY_PATH, { auth: 'reader' })
    .then((payload) => {
      if (cacheGeneration === generation) store(userId, payload);
      return payload;
    })
    .finally(() => {
      if (inFlightByAudience.get(audience) === task) {
        inFlightByAudience.delete(audience);
      }
    });
  inFlightByAudience.set(audience, task);
  return task;
}

/** 登录成功后立即预热；页面挂载时会复用同一个 Promise，不重复请求。 */
export function primeDailyPreference(userId) {
  if (!userId || isFresh(userId) || inFlightByAudience.has(audienceOf(userId))) return;
  void getDailyPreference(userId).catch(() => { /* 页面挂载后仍可正常重试。 */ });
}

/** 保存/覆盖今日选择，同一次往返拿回推荐结果。 */
export async function saveDailyPreference(userId, selections) {
  const payload = await apiFetch(DAILY_PATH, {
    method: 'PUT',
    auth: 'reader',
    body: {
      setting_tags: selections?.setting_tags || [],
      story_tone_tags: selections?.story_tone_tags || [],
      relationship_core_tags: selections?.relationship_core_tags || [],
    },
  });
  return store(userId, payload);
}

/** 登出/换账号时调用，避免跨账号复用。 */
export function clearDailyPreferenceCache() {
  cacheGeneration += 1;
  entry = null;
  inFlightByAudience.clear();
}
