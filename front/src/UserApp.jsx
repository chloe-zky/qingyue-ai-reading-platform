// UserApp.jsx — Mobile app shell for end users + authors.
// Bottom tab nav with three tabs: home / discover / mine.
//   home     → HomeTab (daily atmosphere)
//   discover → ReaderPage (existing recommendation flow, untouched)
//   mine     → MineTab (personal entry, hosts AuthorPage)
//
// Editor/Admin do NOT appear here. They live under StudioPage.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HomeTab    from './HomeTab';
import MineTab    from './MineTab';
import ReaderPage from './ReaderPage';
import { ReadingScreen } from './reader/ReadingScreen.jsx';
import { LoadingScreen } from './reader/LoadingScreen.jsx';
import { deriveTheme } from './reader/themes.js';
import { clearBookDetailCache, getPublicBookDetail } from './lib/bookApi';
import './UserApp.css';
import { useReaderAuth } from './reader/ReaderAuthContext';

const EASTER_EGG_BOOK_ID = 27;
const EASTER_EGG_TAPS = 5;
const EASTER_EGG_TAP_GAP_MS = 1600;
const WARM_KEY = 'reader.warmMode.v1';

const TABS = [
  { key: 'home',     label: '首页', icon: HomeIcon },
  { key: 'discover', label: '发现', icon: DiscoverIcon },
  { key: 'mine',     label: '我的', icon: MineIcon },
];

const RESTORABLE_TABS = new Set(TABS.map((tab) => tab.key));

export default function UserApp({ onExit }) {
  const { session, loading } = useReaderAuth();
  // 每次进入读者空间都从首页开始，不再恢复上次停留的 tab（原来存在
  // localStorage 的 reader.lastMainTab.v1 已连同读写一起删除）：登录后第一眼
  // 应该是今天的推荐，而不是上次退出前碰巧停在的「我的」。
  const [tab, setTab] = useState('home');
  const [discoverReading, setDiscoverReading] = useState(false);
  const [easterArticle, setEasterArticle] = useState(null);
  const [easterOpening, setEasterOpening] = useState(false);
  const [easterError, setEasterError] = useState('');
  const mineTaps = useRef({ count: 0, lastAt: 0 });

  const [warm, setWarm] = useState(() => {
    try { return localStorage.getItem(WARM_KEY) === '1'; } catch { return false; }
  });
  const toggleWarm = useCallback(() => {
    setWarm((current) => {
      const next = !current;
      try { localStorage.setItem(WARM_KEY, next ? '1' : '0'); } catch { /* storage may be unavailable */ }
      return next;
    });
  }, []);
  const easterTheme = useMemo(
    () => deriveTheme({ warm, inFrame: false }),
    [warm],
  );

  const selectTab = (nextTab) => {
    setTab(RESTORABLE_TABS.has(nextTab) ? nextTab : 'home');
  };

  const openEasterEgg = useCallback(async () => {
    setEasterOpening(true);
    setEasterError('');
    try {
      clearBookDetailCache(EASTER_EGG_BOOK_ID);
      const article = await getPublicBookDetail(EASTER_EGG_BOOK_ID);
      setEasterArticle({ ...article, book_id: EASTER_EGG_BOOK_ID });
    } catch (error) {
      setEasterError(error?.detail || error?.message || '彩蛋篇读取失败，请重试');
    } finally {
      setEasterOpening(false);
    }
  }, []);

  const handleTabPress = (key, event) => {
    if (easterArticle || easterOpening || easterError) {
      setEasterArticle(null);
      setEasterError('');
    }
    selectTab(key);
    if (key !== 'mine') {
      mineTaps.current = { count: 0, lastAt: 0 };
      return;
    }
    const now = event.timeStamp;
    const count = now - mineTaps.current.lastAt <= EASTER_EGG_TAP_GAP_MS
      ? mineTaps.current.count + 1
      : 1;
    mineTaps.current = { count, lastAt: now };
    if (count >= EASTER_EGG_TAPS) {
      mineTaps.current = { count: 0, lastAt: 0 };
      openEasterEgg();
    }
  };

  useEffect(() => {
    if (!loading && !session) onExit();
  }, [loading, session, onExit]);

  if (loading || !session) {
    return <div className="userapp-root" style={{ display: 'grid', placeItems: 'center', color: '#777' }}>正在打开读者空间…</div>;
  }

  return (
    <div className="userapp-root">
      <div className="userapp-frame">

        {/* Content area — each tab fills the space above the bottom nav */}
        <div className="userapp-content">
          {tab === 'home'     && <HomeTab onGoDiscover={() => selectTab('discover')} onExit={onExit} />}
          {/*
           * 发现页常驻，只切换显隐。
           *
           * 卸载重挂会丢掉整页状态：正在读的那篇、搜索词与结果、翻到第几辑，
           * 全部归零——用户去「我的」看一眼再回来，文章就没了。
           *
           * 用 visibility 而不是 display：display:none 会销毁布局盒，再显示时
           * 滚动容器的 scrollTop 归零，正文会跳回开头——文章还在，读到哪儿却丢了。
           * visibility 保留布局与滚动位置，配 pointer-events 让隐藏时点击穿透。
           *
           * 首页与「我的」仍按需挂载：它们本来就靠重挂刷新（「我的」每次进入要
           * 重取一次资料计数），常驻反而会让那份数字停住。
           */}
          <div
            className={`userapp-reader-host${tab === 'discover' && !discoverReading ? ' is-page-entering' : ''}`}
            aria-hidden={tab !== 'discover'}
            style={tab === 'discover' ? undefined : {
              visibility: 'hidden',
              pointerEvents: 'none',
            }}
          >
            <ReaderPage active={tab === 'discover'} onReadingChange={setDiscoverReading} />
          </div>
          {tab === 'mine'     && <MineTab onExit={onExit} />}

          {(easterOpening || easterArticle || easterError) && (
            <div className="userapp-reader-host" style={{ zIndex: 5, background: easterTheme.bg }}>
              {easterOpening && <LoadingScreen theme={easterTheme} />}
              {easterArticle && (
                <ReadingScreen
                  theme={easterTheme}
                  article={easterArticle}
                  requestId=""
                  userPrefs={{}}
                  onBack={() => setEasterArticle(null)}
                  warm={warm}
                  onToggleWarm={toggleWarm}
                  respectTopSafeArea
                />
              )}
              {easterError && (
                <div role="alert" style={{ padding: '96px 24px', color: '#7e828a' }}>
                  {easterError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom tab bar */}
        <nav className="userapp-tabbar">
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                className={`userapp-tab ${active ? 'is-active' : ''}`}
                onClick={(event) => handleTabPress(key, event)}
              >
                <Icon active={active} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

      </div>
    </div>
  );
}

// ── Minimal line-art icons ─────────────────────────────────────────────

// ── Icon set — two variants per tab (outlined = inactive, filled = active).
//   inactive: thin grey stroke, no fill
//   active:   solid dark silhouette
// 这是 iOS / ONE 一个 那种"线 → 实"的标准 tab bar 模式。
const ACTIVE_COLOR   = '#15171c';
const INACTIVE_COLOR = '#7e828a';

function HomeIcon({ active }) {
  if (active) {
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill={ACTIVE_COLOR}>
        <path d="M12 3.2L2.5 11.5a1 1 0 0 0 .66 1.75H4.5V20a1 1 0 0 0 1 1H10v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V21h4.5a1 1 0 0 0 1-1v-6.75h1.34a1 1 0 0 0 .66-1.75L12 3.2z"/>
      </svg>
    );
  }
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
      <path d="M3 11.5L12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-8.5z"
        stroke={INACTIVE_COLOR} strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  );
}

function DiscoverIcon({ active }) {
  if (active) {
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill={ACTIVE_COLOR}>
        {/* Solid disc + inner needle cutout via even-odd fill */}
        <path fillRule="evenodd" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm3.5 5.5l-2 5-5 2 2-5 5-2z" />
      </svg>
    );
  }
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke={INACTIVE_COLOR} strokeWidth="1.2"/>
      <path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" stroke={INACTIVE_COLOR} strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  );
}

function MineIcon({ active }) {
  if (active) {
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill={ACTIVE_COLOR}>
        <circle cx="12" cy="8" r="4"/>
        <path d="M4 20.5C4 16.5 7.5 14 12 14s8 2.5 8 6.5a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5z"/>
      </svg>
    );
  }
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8.5" r="3.5" stroke={INACTIVE_COLOR} strokeWidth="1.2"/>
      <path d="M4.5 20c1.2-3.6 4.2-5.5 7.5-5.5s6.3 1.9 7.5 5.5"
        stroke={INACTIVE_COLOR} strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}
