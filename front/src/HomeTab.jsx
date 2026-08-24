// HomeTab.jsx — Daily-reading atmosphere page.
//
// Cover、引文、作者、书名 ——「都来自同一作品」。
// 进入 HomeTab 时拉一次推荐池，过滤出"有封面"的样本随机挑一篇；
// 如果整池都没有配图，整张卡片回落到静态兜底文案（保证一致性，
// 不会出现"封面是占位图但引文是真书"这种混搭）。
//
// 点击封面或引文 → 在 HomeTab 内打开正文阅读视图（ReadingScreen 复用）。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReadingScreen } from './reader/ReadingScreen.jsx';
import { deriveTheme }   from './reader/themes.js';
import { getHomePick }   from './homePickCache';
import './HomeTab.css';

const FALLBACK_COVER = '/covers/cover-01.jpg';
const WARM_KEY       = 'reader.warmMode.v1';   // 与 ReaderPage 共享一份护眼偏好

export default function HomeTab({ onGoDiscover }) {
  const [pick,    setPick]    = useState(null);
  const [requestId, setRequestId] = useState('');
  const [loaded,  setLoaded]  = useState(false);
  const [viewing, setViewing] = useState(null);

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
    (async () => {
      const { pick: p, requestId: fetchedRequestId } = await getHomePick();
      if (cancelled) return;
      if (p) setPick(p);
      setRequestId(fetchedRequestId || '');
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const hasPick  = !!pick;
  const coverUrl = hasPick ? pick.cover_image_url : FALLBACK_COVER;
  const quote    = hasPick ? pick.intro : (loaded ? '今晚，读一篇刚好属于你的故事。' : '');
  const source   = hasPick
    ? `— 选自《${pick.title}》${pick.author ? ` · ${pick.author}` : ''}`
    : (loaded ? '今日轻阅读' : '');

  const handleOpenPick = () => { if (hasPick) setViewing(pick); };

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
        />
      </div>
    );
  }

  // ── Atmosphere card ──────────────────────────────────────────────
  return (
    <div className="hometab-root">

      <div className="hometab-eyebrow">今 日 轻 阅 读</div>

      <div
        className={`hometab-cover ${hasPick ? 'is-clickable' : ''}`}
        style={{ backgroundImage: `url(${coverUrl})` }}
        onClick={hasPick ? handleOpenPick : undefined}
        role={hasPick ? 'button' : undefined}
        aria-label={hasPick ? `进入《${pick.title}》正文` : undefined}
      />

      <div className="hometab-quote-block">
        <span className="hometab-quote-mark hometab-quote-mark-open">「</span>
        <p
          className={`hometab-quote ${hasPick ? 'is-clickable' : ''}`}
          onClick={hasPick ? handleOpenPick : undefined}
        >
          {quote}
        </p>
        {source && <div className="hometab-source">{source}</div>}
      </div>

      <div className="hometab-actions">
        <button className="hometab-cta" onClick={onGoDiscover}>
          去发现更多故事 →
        </button>
      </div>

    </div>
  );
}
