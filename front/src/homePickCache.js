// homePickCache.js — module-level "today's home pick" prefetcher.
//
// 在 LandingPage 出现时就把首页要展示的随机作品+封面预拉一次，
// 这样用户点"登录 / 注册"进 UserApp → 首页时，数据通常已经就绪，
// 无需再等一次网络。
//
// 设计要点：
//   - 单例 in-flight promise，多处并发调用安全
//   - 解析后顺手做一次 Image() 预热，让封面在 HomeTab 渲染瞬间已在浏览器缓存
//   - 不缓存失败：第一次失败后下次访问仍会重试
//   - 同会话内 pick 稳定（首次随机后不再变），与之前 HomeTab 行为一致

import { apiFetch } from './lib/apiClient';

let inFlight = null;   // Promise<void> | null
let resolved = null;   // { pick, requestId } | null  (pick may be null = no candidate)
let resolvedAudience = null; // 'anonymous' | reader user id | null

function preheatImage(url) {
  if (!url) return;
  try { const img = new Image(); img.src = url; } catch { /* ignore */ }
}

function startFetch(readerId = null) {
  inFlight = (async () => {
    try {
      const data = await apiFetch('/api/recommendations', {
        method:  'POST',
        auth: readerId ? 'reader' : false,
        body: {
          setting_tags: [],
          story_tone_tags: [],
          relationship_core_tags: [],
        },
      });
      const list = Array.isArray(data?.results) ? data.results : [];
      const withCover = list.filter((b) => (b.cover_image_url || '').trim());
      const pick = withCover.length > 0
        ? withCover[Math.floor(Math.random() * withCover.length)]
        : null;
      if (pick) preheatImage(pick.cover_image_url);
      resolved = { pick, requestId: data?.request_id || '' };
      resolvedAudience = readerId || 'anonymous';
    } catch {
      // 失败不写 resolved——下次调用会重新尝试
      resolved = null;
      resolvedAudience = null;
    } finally {
      inFlight = null;
    }
  })();
}

/**
 * 触发预拉（idempotent）。LandingPage mount 时调用一次即可。
 */
export function primeHomePick() {
  if (resolved || inFlight) return;
  startFetch(null);
}

/**
 * HomeTab 消费入口。
 * - 已 resolved → 立刻返回（同步快路径）
 * - in-flight   → 等待同一个 promise
 * - 都没有      → 起一次新的 fetch
 */
export async function getHomePick({ readerId = null } = {}) {
  if (resolved && (!readerId || resolvedAudience === readerId)) return resolved;
  if (inFlight) await inFlight;
  if (resolved && (!readerId || resolvedAudience === readerId)) return resolved;
  if (!inFlight) startFetch(readerId);
  await inFlight;
  return resolved || { pick: null, requestId: '' };
}
