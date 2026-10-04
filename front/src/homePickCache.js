// homePickCache.js — module-level "today's home pick" prefetcher.
//
// 在 LandingPage 出现时就把首页要展示的随机作品+封面预拉一次，
// 这样用户点"登录 / 注册"进 UserApp → 首页时，数据通常已经就绪，
// 无需再等一次网络。
//
// 设计要点：
//   - 网络层已下沉到 lib/recommendationCache（60s TTL + in-flight 复用），
//     首页的空偏好请求与 ReaderPage 的空偏好请求因此共用同一次网络往返
//   - 每个 audience 复用一个 in-flight Promise，多处并发调用安全
//   - 解析后 await 封面的 load/decode 再 resolve：HomeTab 拿到结果时封面已可绘制，
//     文字与图片可以一次性揭示，不会出现"框先出现、图后出现"的两段式加载
//   - 不缓存失败：第一次失败后下次访问仍会重试
//   - 同会话内 pick 稳定（首次随机后不再变）——这一层刻意不跟随 60s TTL，
//     否则用户在首页停留一分钟后回来，"今日轻阅读"会换成另一篇

import { preloadImage } from './lib/imagePreload';
import { audienceOf, getRecommendations } from './lib/recommendationCache';

const EMPTY_PREFS = {
  setting_tags: [],
  story_tone_tags: [],
  relationship_core_tags: [],
};

// 匿名与登录读者各自复用自己的结果和在途请求。原先只有一个全局 Promise：
// 登录发生在匿名预拉尚未结束时，登录用户会先等匿名请求，再发自己的请求，形成
// 两次串行等待。按 audience 分桶后两条链互不阻塞，Map 查找也是 O(1)。
const MAX_AUDIENCES = 4;
const resolvedByAudience = new Map();
const inFlightByAudience = new Map();
const generationByAudience = new Map();

function generationOf(audience) {
  return generationByAudience.get(audience) || 0;
}

function remember(audience, value) {
  resolvedByAudience.delete(audience);
  resolvedByAudience.set(audience, value);
  while (resolvedByAudience.size > MAX_AUDIENCES) {
    resolvedByAudience.delete(resolvedByAudience.keys().next().value);
  }
}

function startFetch(readerId = null) {
  const audience = audienceOf(readerId);
  const existing = inFlightByAudience.get(audience);
  if (existing) return existing;
  const generation = generationOf(audience);

  const task = (async () => {
    try {
      const { results, requestId } = await getRecommendations({
        audience: readerId,
        prefs: EMPTY_PREFS,
      });
      const withCover = results.filter((b) => (b.cover_image_url || '').trim());
      const pick = withCover.length > 0
        ? withCover[Math.floor(Math.random() * withCover.length)]
        : null;
      // 等封面真正可绘制再 resolve —— 首页据此做「文字+封面」原子揭示。
      const coverReady = pick ? await preloadImage(pick.cover_image_url) : false;
      if (generationOf(audience) === generation) {
        remember(audience, { pick, requestId, coverReady });
      }
    } catch {
      // 失败不写缓存——下次调用会重新尝试。
      if (generationOf(audience) === generation) {
        resolvedByAudience.delete(audience);
      }
    } finally {
      if (inFlightByAudience.get(audience) === task) {
        inFlightByAudience.delete(audience);
      }
    }
  })();
  inFlightByAudience.set(audience, task);
  return task;
}

/**
 * 触发预拉（idempotent）。LandingPage mount 时调用一次即可。
 */
export function primeHomePick(readerId = null) {
  const audience = audienceOf(readerId);
  if (resolvedByAudience.has(audience) || inFlightByAudience.has(audience)) return;
  void startFetch(readerId);
}

/**
 * 同步读取已就绪的结果（含 coverReady），没有则返回 null。
 * HomeTab 用它做首屏初值：首页 ⇄ 发现 来回切换时直接进 ready，不再闪加载态。
 */
export function peekHomePick({ readerId = null } = {}) {
  return resolvedByAudience.get(audienceOf(readerId)) || null;
}

/**
 * HomeTab 消费入口。
 * - 已 resolved → 立刻返回（同步快路径）
 * - in-flight   → 等待同一个 promise
 * - 都没有      → 起一次新的 fetch
 *
 * 返回 { pick, requestId, coverReady }。coverReady=false 时调用方应走静态兜底：
 * 同一会话内不再重试，避免每次切回首页都为一张坏图重新等 6 秒。
 */
export async function getHomePick({ readerId = null } = {}) {
  const audience = audienceOf(readerId);
  const cached = resolvedByAudience.get(audience);
  if (cached) return cached;
  await startFetch(readerId);
  return resolvedByAudience.get(audience)
    || { pick: null, requestId: '', coverReady: false };
}

export function clearHomePickCache(readerId = null) {
  const audience = audienceOf(readerId);
  generationByAudience.set(audience, generationOf(audience) + 1);
  resolvedByAudience.delete(audience);
  inFlightByAudience.delete(audience);
}
