// UserApp.jsx — Mobile app shell for end users + authors.
// Bottom tab nav with three tabs: home / discover / mine.
//   home     → HomeTab (daily atmosphere)
//   discover → ReaderPage (existing recommendation flow, untouched)
//   mine     → MineTab (personal entry, hosts AuthorPage)
//
// Editor/Admin do NOT appear here. They live under StudioPage.

import { useEffect, useState } from 'react';
import HomeTab    from './HomeTab';
import MineTab    from './MineTab';
import ReaderPage from './ReaderPage';
import './UserApp.css';
import { useReaderAuth } from './reader/ReaderAuthContext';

const TABS = [
  { key: 'home',     label: '首页', icon: HomeIcon },
  { key: 'discover', label: '发现', icon: DiscoverIcon },
  { key: 'mine',     label: '我的', icon: MineIcon },
];

export default function UserApp({ onExit }) {
  const { session, loading } = useReaderAuth();
  const [tab, setTab] = useState('home');

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
          {tab === 'home'     && <HomeTab onGoDiscover={() => setTab('discover')} onExit={onExit} />}
          {tab === 'discover' && (
            <div className="userapp-reader-host">
              <ReaderPage />
            </div>
          )}
          {tab === 'mine'     && <MineTab onExit={onExit} />}
        </div>

        {/* Bottom tab bar */}
        <nav className="userapp-tabbar">
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                className={`userapp-tab ${active ? 'is-active' : ''}`}
                onClick={() => setTab(key)}
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
