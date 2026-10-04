// lib/imagePreload.js — 把一张图提前下载并解码，让真正渲染它的那个 <img>
// 直接命中浏览器缓存。
//
// 原本只服务于首页封面（homePickCache 里的私有实现），头像预热要用同一套：
//   - 同一 url 的并发/重复调用复用同一个 promise，不会开出多份请求
//   - 优先 decode()（真正解码完成），老 WebView 上回落到 onload
//   - 超时兜底，绝不让调用方为一张坏图一直挂着
//
// 注意不要给这里的 Image 设 crossOrigin：页面上的 <img> 也没设，两边必须
// 保持一致，否则算两条缓存条目，预热就白做了。

const DEFAULT_TIMEOUT_MS = 6_000;

/** url -> Promise<boolean> */
const preloads = new Map();

/**
 * 调 img.decode() 并返回一个 promise；不支持、抛错、或返回非 promise
 * （老 WebView 见过）时返回 null，交给 onload/onerror 判定。
 */
function safeDecode(img) {
  if (typeof img.decode !== 'function') return null;
  try {
    const task = img.decode();
    return task && typeof task.then === 'function' ? task : null;
  } catch {
    return null;
  }
}

/**
 * 预加载一张图并等到「可绘制」为止。
 * 成功返回 true；加载失败、解码失败或超时返回 false。
 */
export function preloadImage(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!url) return Promise.resolve(false);
  const existing = preloads.get(url);
  if (existing) return existing;

  const task = new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(ok);
    };
    timer = setTimeout(() => finish(false), timeoutMs);
    try {
      const img = new Image();
      img.onload = () => {
        // 已 load 的图即使 decode 不可用或抛错也能被 <img> 画出来，一律算就绪。
        const decoding = safeDecode(img);
        if (decoding) decoding.then(() => finish(true), () => finish(true));
        else finish(true);
      };
      img.onerror = () => finish(false);
      img.src = url;
      // decode() 可能早于 onload 完成；失败则等 onload / onerror / 超时。
      safeDecode(img)?.then(() => finish(true), () => { /* 见上 */ });
    } catch {
      finish(false);   // 非浏览器环境（无 Image 构造器）
    }
  });

  preloads.set(url, task);
  return task;
}
