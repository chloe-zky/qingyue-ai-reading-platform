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

const API_BASE = `http://${window.location.hostname}:8000`;

let inFlight = null;   // Promise<void> | null
let resolved = null;   // { pick, requestId } | null  (pick may be null = no candidate)

function preheatImage(url) {
  if (!url) return;
  try { const img = new Image(); img.src = url; } catch { /* ignore */ }
}

function startFetch() {
  inFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/recommendations`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          setting_tags: [],
          story_tone_tags: [],
          relationship_core_tags: [],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data?.results) ? data.results : [];
      const withCover = list.filter((b) => (b.cover_image_url || '').trim());
      const pick = withCover.length > 0
        ? withCover[Math.floor(Math.random() * withCover.length)]
        : null;
      if (pick) preheatImage(pick.cover_image_url);
      resolved = { pick, requestId: data?.request_id || '' };
    } catch {
      // 失败不写 resolved——下次调用会重新尝试
      resolved = null;
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
  startFetch();
}

/**
 * HomeTab 消费入口。
 * - 已 resolved → 立刻返回（同步快路径）
 * - in-flight   → 等待同一个 promise
 * - 都没有      → 起一次新的 fetch
 */
export async function getHomePick() {
  if (resolved) return resolved;
  if (!inFlight) startFetch();
  await inFlight;
  return resolved || { pick: null, requestId: '' };
}
