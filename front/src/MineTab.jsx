// MineTab.jsx — “我的”页（读者 / 作者合并入口）。
// 按《作者端交付说明.md》第 2 节实现：
//   · 无分区标题、无独立报头，所有条目平铺为一列；
//   · 头像 + 笔名 + 读者天数，整屏垂直居中、重心略偏上；
//   · “作者中心”为点睛色 · 浅底强调行，点击进入既有作者中心（AuthorPage）。
//
// 仅负责“我的”一页。底部 Tab 栏（UserApp）与作者中心（AuthorPage）均不改动。

import { useCallback, useMemo, useState } from 'react';
import AuthorCenter from './author/AuthorCenter';
import { readerApi } from './lib/readerApi';
import { ReadingScreen } from './reader/ReadingScreen';
import { useReaderAuth } from './reader/ReaderAuthContext';
import { deriveTheme } from './reader/themes';
import './MineTab.css';

const WARM_KEY = 'reader.warmMode.v1';

// 线笔小鸟（decor.jsx 中的 Bird，纯 stroke，颜色继承 currentColor）。
function Bird({ size = 30, style }) {
  return (
    <svg viewBox="0 0 48 40" width={size} height={(size * 40) / 48}
         fill="none" stroke="currentColor" strokeWidth="1.4"
         strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
      <path d="M10 26 C 10 16, 18 12, 26 14 C 33 15.5, 38 20, 42 18" />
      <path d="M42 18 L 46 16.5 M42 18 C 40 15, 41 12, 43 11" />
      <circle cx="41" cy="15.5" r="0.8" fill="currentColor" stroke="none" />
      <path d="M20 15 C 22 8, 28 6, 32 9 C 28 11, 24 13, 22 16" />
      <path d="M10 26 C 6 27, 4 29, 3 32 M10 26 C 7 29, 6 32, 6 35" />
      <path d="M22 26 L 21 31 M27 26 L 27 31" />
    </svg>
  );
}

// 单个条目行。value 为空时只显示右侧箭头。accent 用于“作者中心”指向。
function ProfileRow({ label, value, onClick, accent = false, disabled = false }) {
  return (
    <button
      type="button"
      className={`minetab-row${accent ? ' is-accent' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="minetab-row-label">{label}</span>
      <span className={`minetab-row-value${accent ? ' is-accent' : ''}`}>
        {value}
        <span className="minetab-row-arrow">›</span>
      </span>
    </button>
  );
}

export default function MineTab({ onExit }) {
  const {
    session, profile, profileError, signOut, updateProfile, refreshProfile,
    requestPasswordReset, updatePersonalization,
  } = useReaderAuth();
  const [view, setView] = useState('mine');
  const [readingOrigin, setReadingOrigin] = useState('history');
  const [currentBook, setCurrentBook] = useState(null);
  const [items, setItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemError, setItemError] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState('');
  const [personalizationBusy, setPersonalizationBusy] = useState(false);
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
  const theme = useMemo(() => deriveTheme({ warm, inFrame: false }), [warm]);

  async function openCollection(kind) {
    setView(kind); setItems([]); setLoadingItems(true); setItemError('');
    try { setItems(kind === 'favorites' ? await readerApi.favorites() : await readerApi.history()); }
    catch (error) { setItemError(error.detail || error.message || '读取失败'); }
    finally { setLoadingItems(false); }
  }

  async function removeFavorite(bookId) {
    try {
      await readerApi.removeFavorite(bookId);
      setItems((current) => current.filter((item) => item.book_id !== bookId));
      await refreshProfile();
    } catch (error) { setItemError(error.detail || error.message || '取消收藏失败'); }
  }

  async function saveName() {
    if (!displayName.trim()) return;
    setSavingName(true); setItemError('');
    try { await updateProfile(displayName.trim()); setView('mine'); }
    catch (error) { setItemError(error.detail || error.message || '昵称保存失败'); }
    finally { setSavingName(false); }
  }

  async function sendPasswordReset() {
    const email = session?.user?.email;
    if (!email || resetBusy) return;
    setResetBusy(true); setItemError(''); setAccountMessage('');
    try {
      await requestPasswordReset(email);
      setAccountMessage('重置邮件已发送。请在当前设备上打开邮件中的链接。');
    } catch (error) {
      setItemError(error.message || '重置邮件发送失败，请稍后再试');
    } finally { setResetBusy(false); }
  }

  async function togglePersonalization() {
    if (personalizationBusy) return;
    setPersonalizationBusy(true); setItemError(''); setAccountMessage('');
    try {
      const enabled = !profile?.personalization_enabled;
      await updatePersonalization(enabled);
      setAccountMessage(enabled ? '个性化推荐已开启。' : '个性化推荐已关闭，之后只使用你当次选择的偏好。');
    } catch (error) {
      setItemError(error.detail || error.message || '个性化设置保存失败');
    } finally { setPersonalizationBusy(false); }
  }

  function openBook(item) {
    setReadingOrigin(view);
    setCurrentBook(item);
    setView('reading');
  }

  async function logout() { await signOut(); onExit(); }

  // 作者中心：以全屏浮层打开 AuthorCenter（进入页 → 稿件 → 投稿四步 → 回执 / 查询）。
  // 浮层自带顶栏与「我的」返回；退出浮层回到本页。底部 Tab 栏代码不改动，仅被浮层遮住。
  if (view === 'author') {
    return <AuthorCenter onExit={() => setView('mine')} userName={profile?.display_name || '作者'} />;
  }

  if (view === 'reading' && currentBook) {
    return <div className="minetab-root"><div className="minetab-reading-host">
      <ReadingScreen
        theme={theme}
        article={currentBook}
        requestId=""
        userPrefs={{}}
        onBack={() => setView(readingOrigin)}
        warm={warm}
        onToggleWarm={toggleWarm}
      />
    </div></div>;
  }

  if (view === 'favorites' || view === 'history') {
    return <div className="minetab-root"><div className="minetab-list-view">
      <button className="minetab-back" onClick={() => setView('mine')}>我的</button>
      <h2>{view === 'favorites' ? '我的收藏' : '阅读历史'}</h2>
      {loadingItems && <div className="minetab-state">正在读取…</div>}
      {itemError && <div className="minetab-state is-error">{itemError}</div>}
      {!loadingItems && !itemError && items.length === 0 && <div className="minetab-state">{view === 'favorites' ? '还没有收藏作品。' : '还没有阅读记录。'}</div>}
      <div className="minetab-books">{items.map((item) => <article className="minetab-book" key={item.book_id}>
        <button type="button" className="minetab-book-open" onClick={() => openBook(item)} aria-label={`打开《${item.title}》继续阅读`}>
          <div className="minetab-book-cover" style={item.cover_image_url ? { backgroundImage: `url(${item.cover_image_url})` } : undefined} />
          <div className="minetab-book-main"><div className="minetab-book-title">{item.title}</div><div className="minetab-book-author">文 / {item.author}</div>{view === 'history' && <div className="minetab-progress"><span style={{ width: `${item.progress_percent || 0}%` }} /></div>}</div>
        </button>
        {view === 'favorites' && <button className="minetab-remove" onClick={() => removeFavorite(item.book_id)}>取消收藏</button>}
      </article>)}</div>
    </div></div>;
  }

  if (view === 'account') {
    return <div className="minetab-root"><div className="minetab-list-view">
      <button className="minetab-back" onClick={() => setView('mine')}>我的</button>
      <h2>账号与安全</h2>
      <label className="minetab-account-field">昵称<input value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} /></label>
      <label className="minetab-account-field">邮箱<input value={session?.user?.email || ''} disabled /></label>
      <div className="minetab-personalization">
        <div><strong>个性化推荐</strong><span>根据收藏、完读和主动反馈调整推荐；不记录逐次滚动。</span></div>
        <button type="button" role="switch" aria-checked={profile?.personalization_enabled !== false} className={`minetab-switch${profile?.personalization_enabled !== false ? ' is-on' : ''}`} onClick={togglePersonalization} disabled={personalizationBusy}><span /></button>
      </div>
      {itemError && <div className="minetab-state is-error">{itemError}</div>}
      {accountMessage && <div className="minetab-state is-success">{accountMessage}</div>}
      <button className="minetab-save" onClick={saveName} disabled={savingName}>{savingName ? '保存中…' : '保存昵称'}</button>
      <button className="minetab-reset-password" onClick={sendPasswordReset} disabled={resetBusy}>{resetBusy ? '发送中…' : '发送密码重置邮件'}</button>
    </div></div>;
  }

  const name = profile?.display_name || '读者';

  return (
    <div className="minetab-root">
      <div className="minetab-content">

        {/* 头像 + 笔名 + 读者天数 —— 无独立报头 */}
        <header className="minetab-id">
          <div className="minetab-avatar" aria-hidden="true">
            {name.slice(0, 1)}
          </div>
          <div className="minetab-id-text">
            <div className="minetab-name">{name}</div>
            <div className="minetab-days">读者 · 第 {profile?.reader_days || 1} 天</div>
          </div>
          <Bird size={30} style={{ position: 'absolute', top: 4, right: 2, color: 'var(--mt-ink-4)' }} />
        </header>

        {/* 条目一列平铺，无分区标题 */}
        <div className="minetab-group">
          <ProfileRow label="余额" value="暂未开放" disabled />
          <ProfileRow label="充值" value="暂未开放" disabled />
          <ProfileRow label="收藏" value={`${profile?.favorites_count || 0} 篇`} onClick={() => openCollection('favorites')} />
          <ProfileRow label="阅读历史" value={`${profile?.history_count || 0} 篇`} onClick={() => openCollection('history')} />
          <ProfileRow
            label="作者中心"
            value="投稿 · 查询"
            accent
            onClick={() => setView('author')}
          />
          <ProfileRow label="账号与安全" value="" onClick={() => { setDisplayName(profile?.display_name || ''); setItemError(''); setAccountMessage(''); setView('account'); }} />
          <ProfileRow label="退出登录" value="" onClick={logout} />
        </div>

        {profileError && <div className="minetab-state is-error">{profileError}</div>}

      </div>
    </div>
  );
}
