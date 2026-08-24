// App.jsx — top-level mode switcher.
// Three modes: landing / user / studio.
//   landing → LandingPage (entry, login/register; no visible studio entry)
//   user    → UserApp     (bottom-tab mobile app: 首页/发现/我的)
//   studio  → StudioPage  (three-role internal backend, hidden from end users)
//
// Studio is intentionally NOT exposed in the end-user surface.
// It can be reached two ways — both equivalent:
//   (1) 独立模式：URL with `?mode=studio` or `#studio`
//                  e.g. http://192.168.0.111:5173/?mode=studio
//   (2) 隐藏入口：on LandingPage, tap the "— 轻 阅 读 —" eyebrow 5 times
//                  within 2.5 seconds (handled inside LandingPage)
//
// No real auth — these are demo transitions only.

import { lazy, Suspense, useEffect, useState } from 'react';
import LandingPage from './LandingPage';
import './App.css';

const UserApp = lazy(() => import('./UserApp'));
const StudioPage = lazy(() => import('./StudioPage'));

function ModeFallback() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', color: '#777' }}>
      正在打开轻阅读…
    </div>
  );
}

function detectInitialMode() {
  if (typeof window === 'undefined') return 'landing';
  const { search, hash } = window.location;
  if (hash && hash.toLowerCase() === '#studio')          return 'studio';
  if (search && /(^|[?&])mode=studio(&|$)/i.test(search)) return 'studio';
  return 'landing';
}

export default function App() {
  const [appMode, setAppMode] = useState(detectInitialMode);

  // Clean the URL once we've consumed the studio flag, so subsequent
  // navigations (back to landing) don't immediately re-enter studio.
  useEffect(() => {
    if (appMode !== 'studio') return;
    if (typeof window === 'undefined') return;
    const { hash, search, pathname } = window.location;
    if (hash.toLowerCase() === '#studio' || /(^|[?&])mode=studio(&|$)/i.test(search)) {
      window.history.replaceState({}, '', pathname);
    }
  }, [appMode]);

  return (
    <div className="app-shell">
      {appMode === 'landing' && <LandingPage onNavigate={setAppMode} />}
      <Suspense fallback={<ModeFallback />}>
        {appMode === 'user'   && <UserApp onExit={() => setAppMode('landing')} />}
        {appMode === 'studio' && <StudioPage onExit={() => setAppMode('landing')} />}
      </Suspense>
    </div>
  );
}
