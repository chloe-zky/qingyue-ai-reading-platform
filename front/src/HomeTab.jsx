// HomeTab.jsx — Daily-reading atmosphere page.
//
// Cover、引文、作者、书名 ——「都来自同一作品」。
// 进入 HomeTab 时拉一次推荐池，过滤出"有封面"的样本随机挑一篇；
// 如果整池都没有配图，整张卡片回落到静态兜底文案（保证一致性，
// 不会出现"封面是占位图但引文是真书"这种混搭）。
//
// 三态原子揭示（loading / ready / fallback）：
//   loading  — 推荐或封面还没就绪。只显示一块保持最终高度的纸色占位区，
//              不渲染假封面、不渲染空引文框，避免"先出框、再换字、最后出图"。
//   ready    — 推荐数据 + 封面已 decode。封面/引文/出处/CTA 一次性出现，
//              整个内容容器只做一次淡入。
//   fallback — 没有候选、或封面加载失败/超时。同样一次性显示静态兜底卡片，
//              绝不无限转圈。
//
// 点击封面或引文 → 在 HomeTab 内打开正文阅读视图（ReadingScreen 复用）。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReadingScreen } from './reader/ReadingScreen.jsx';
import { LoadingScreen } from './reader/LoadingScreen.jsx';
import { deriveTheme }   from './reader/themes.js';
import { getHomePick, peekHomePick } from './homePickCache';
import { hydrateArticle } from './lib/bookApi';
import { useReaderAuth } from './reader/ReaderAuthContext';
import './HomeTab.css';

const WARM_KEY = 'reader.warmMode.v1';   // 与 ReaderPage 共享一份护眼偏好

const FALLBACK_QUOTE  = '今晚，读一篇刚好属于你的故事。';
const FALLBACK_SOURCE = '今日轻阅读';
const LOADING_VIEW    = { status: 'loading', pick: null, requestId: '' };

/**
 * 把 homePickCache 的结果压成一个原子 view model。
 * 只有「有 pick 且封面已可绘制」才是 ready；其余一律 fallback，
 * 保证封面与文字永远同时出现、且不会出现真引文配假封面的混搭。
 */
function toView(result) {
  if (!result) return LOADING_VIEW;
  const requestId = result.requestId || '';
  return result.pick && result.coverReady
    ? { status: 'ready', pick: result.pick, requestId }
    : { status: 'fallback', pick: null, requestId };
}

export default function HomeTab({ onGoDiscover }) {
  const { session } = useReaderAuth();
  const readerId = session?.user?.id || null;

  // 首屏初值同步取已就绪的结果：首页 ⇄ 发现 来回切换时直接 ready，不闪加载态。
  const [view, setView] = useState(() => toView(peekHomePick({ readerId })));
  const [viewing, setViewing] = useState(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');

  // 复用 ReaderPage 同款护眼偏好与主题派生
  const [warm, setWarm] = useState(() => {
    try { return localStorage.getItem(WARM_KEY) === '1'; } catch { return false; }
  });
  const toggleWarm = useCallback(() => {
    setWarm((w) => {
      const next = !w;
      try { localStorage.setItem(WARM_KEY, next ? '1' : '0'); } catch { /* storage may be unavailable */ }
      return next;
    });
  }, []);
  const theme = useMemo(() => deriveTheme({ warm, inFrame: false }), [warm]);

  useEffect(() => {
    let cancelled = false;
    // 优先吃 LandingPage 阶段预拉好的缓存；若用户绕过了 LandingPage（例如
    // 直接进入 UserApp 的某种调试路径），getHomePick 会自己起一次 fetch。
    // getHomePick 内部已等到封面可绘制，这里一次 setState 写入完整 view model，
    // 不产生 pick / requestId / loaded 分批落地的中间帧。
    (async () => {
      const result = await getHomePick({ readerId });
      if (cancelled) return;   // StrictMode 双跑 & 卸载后禁止落状态
      setView(toView(result));
    })();
    return () => { cancelled = true; };
  }, [readerId]);

  const { status, pick, requestId } = view;
  const hasPick = status === 'ready';
  const quote   = hasPick ? pick.intro : FALLBACK_QUOTE;
  const source  = hasPick
    ? `— 选自《${pick.title}》${pick.author ? ` · ${pick.author}` : ''}`
    : FALLBACK_SOURCE;

  const handleOpenPick = async () => {
    if (!hasPick || opening) return;
    setOpening(true);
    setOpenError('');
    try {
      setViewing(await hydrateArticle(pick));
    } catch (error) {
      setOpenError(error?.detail || error?.message || '正文读取失败，请稍后再试');
    } finally {
      setOpening(false);
    }
  };

  if (opening) {
    return <div className="hometab-reading-host"><LoadingScreen theme={theme} /></div>;
  }

  // ── Reading overlay ──────────────────────────────────────────────
  if (viewing) {
    return (
      <div className="hometab-reading-host">
        <ReadingScreen
          theme={theme}
          article={viewing}
          requestId={requestId}
          userPrefs={{}}
          onBack={() => setViewing(null)}
          warm={warm}
          onToggleWarm={toggleWarm}
          respectTopSafeArea
        />
      </div>
    );
  }

  // ── Atmosphere card ──────────────────────────────────────────────
  // 根节点在三态之间保持同一个 DOM 节点：只有内部内容切换，
  // 页面本身的入场动画不会因为数据到达而重播。
  return (
    <div className="hometab-root" aria-busy={status === 'loading'}>

      <div className="hometab-eyebrow">今 日 轻 阅 读</div>

      {status === 'loading' ? (
        <div className="hometab-loading" role="status">
          <span className="hometab-loading-text">正在挑选今晚的故事…</span>
          <span className="hometab-loading-dots" aria-hidden="true">
            <i /><i /><i />
          </span>
        </div>
      ) : (
        <div className="hometab-content">

          {hasPick ? (
            <button
              type="button"
              className="hometab-cover hometab-cover-button"
              onClick={handleOpenPick}
              aria-label={`进入《${pick.title}》正文`}
            >
              {/* 图片已在 homePickCache 预解码，这里是命中浏览器缓存的即时绘制 */}
              <img
                className="hometab-cover-img"
                src={pick.cover_image_url}
                alt=""
                loading="eager"
                decoding="async"
                fetchPriority="high"
              />
            </button>
          ) : (
            <div className="hometab-cover" aria-hidden="true" />
          )}

          <div className="hometab-quote-block">
            <span className="hometab-quote-mark hometab-quote-mark-open">「</span>
            <p
              className={`hometab-quote ${hasPick ? 'is-clickable' : ''}`}
              onClick={hasPick ? handleOpenPick : undefined}
            >
              {quote}
            </p>
            <div className="hometab-source">{source}</div>
          </div>

          <div className="hometab-actions">
            {openError && <div role="alert">{openError}</div>}
            <button className="hometab-cta" onClick={onGoDiscover}>
              去发现更多故事 →
            </button>
          </div>

        </div>
      )}

    </div>
  );
}
