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
// 读者与 Studio 使用相互隔离的 Supabase Auth 会话；业务数据统一走 FastAPI。

import { lazy, Suspense, useEffect, useState } from 'react';
import LandingPage from './LandingPage';
import ReaderAuthProvider from './reader/ReaderAuthProvider';
import './App.css';

const UserApp = lazy(() => import('./UserApp'));
const StudioPage = lazy(() => import('./StudioPage'));
const AuthorCenter = lazy(() => import('./author/AuthorCenter'));

const MODE_PATHS = {
  landing: '/',
  user: '/reader',
  author: '/author',
  studio: '/studio/login',
};

function ModeFallback() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', color: '#777' }}>
      正在打开轻阅读…
    </div>
  );
}

function detectInitialMode() {
  if (typeof window === 'undefined') return 'landing';
  const { pathname, search, hash } = window.location;
  if (pathname === '/author' || pathname.startsWith('/author/')) return 'author';
  if (pathname === '/reader' || pathname.startsWith('/reader/')) return 'user';
  if (pathname === '/studio' || pathname.startsWith('/studio/')) return 'studio';
  if (hash && hash.toLowerCase() === '#studio')          return 'studio';
  if (search && /(^|[?&])mode=studio(&|$)/i.test(search)) return 'studio';
  return 'landing';
}

function hasPendingAuthCallback(search, hash) {
  const action = new URLSearchParams(search).get('auth_action');
  if (action === 'invite' || action === 'recovery') return true;
  const fragment = new URLSearchParams((hash || '').replace(/^#/, ''));
  return fragment.has('access_token') || fragment.has('refresh_token') || fragment.has('error');
}

function AppContent() {
  const [appMode, setAppMode] = useState(detectInitialMode);

  const navigate = (mode, { replace = false } = {}) => {
    const path = MODE_PATHS[mode] || '/';
    window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    setAppMode(mode);
  };

  useEffect(() => {
    const onPopState = () => setAppMode(detectInitialMode());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // 普通 Studio 入口消费后清理 URL；邀请/找回密码回调必须保留到
  // supabase-js 建立会话并由 StaffAuthProvider 主动清理。
  useEffect(() => {
    if (appMode !== 'studio') return;
    if (typeof window === 'undefined') return;
    const { hash, search } = window.location;
    if (hasPendingAuthCallback(search, hash)) return;
    if (hash.toLowerCase() === '#studio' || /(^|[?&])mode=studio(&|$)/i.test(search)) {
      window.history.replaceState({}, '', '/studio/login');
    }
  }, [appMode]);

  return (
    <div className="app-shell">
      {appMode === 'landing' && <LandingPage onNavigate={navigate} />}
      <Suspense fallback={<ModeFallback />}>
        {appMode === 'user' && <UserApp onExit={() => navigate('landing')} />}
        {appMode === 'author' && <AuthorCenter onExit={() => navigate('landing')} />}
        {appMode === 'studio' && <StudioPage onExit={() => navigate('landing')} />}
      </Suspense>
    </div>
  );
}

export default function App() {
  return <ReaderAuthProvider><AppContent /></ReaderAuthProvider>;
}
