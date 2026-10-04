// MineTab.jsx — “我的”页（读者 / 作者合并入口）。
// 按《作者端交付说明.md》第 2 节实现：
//   · 无分区标题、无独立报头，所有条目平铺为一列；
//   · 头像 + 笔名 + 读者天数，整屏垂直居中、重心略偏上；
//   · “作者中心”为点睛色 · 浅底强调行，点击进入既有作者中心（AuthorPage）。
//
// 仅负责“我的”一页。底部 Tab 栏（UserApp）与作者中心（AuthorPage）均不改动。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AuthorCenter from './author/AuthorCenter';
import { readerApi } from './lib/readerApi';
import { hydrateArticle } from './lib/bookApi';
import { OPEN_WIDTH, endSwipe, moveSwipe, startSwipe } from './lib/swipeRow';
import { compressAvatar, validateAvatarFile } from './lib/imageResize';
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

// 阅读历史行：可左滑露出「删除」。收藏列表不用这个交互（收藏有自己的取消按钮）。
//
// 手势逻辑在 lib/swipeRow.js 里，这里只负责把位移接到 DOM 上：
// 方向判定、边界钳制、松手吸附都在那边，可以脱离页面直接断言。
function SwipeableHistoryRow({ item, isOpen, onOpen, onClose, onDelete, deleting, children }) {
  // 只保存「手指正在拖动的位移」；null = 没在拖。展开与否由父组件的 isOpen 决定，
  // 行内不再镜像一份状态——否则「别人展开了，我要收回」就得靠 effect 去同步。
  const [drag, setDrag] = useState(null);
  const gesture = useRef(null);
  const offset = drag !== null ? drag : (isOpen ? -OPEN_WIDTH : 0);

  // 用 Pointer Events 而不是 Touch Events：React 把 touchmove 挂成 passive 监听，
  // 里面的 preventDefault 根本不生效；而横向拦截本来就该交给 CSS 的
  // touch-action: pan-y。改用 pointer 还顺带让桌面鼠标也能拖。
  const handlePointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    gesture.current = startSwipe(event.clientX, event.clientY, isOpen);
  };

  const handlePointerMove = (event) => {
    if (!gesture.current) return;
    const moved = moveSwipe(gesture.current, event.clientX, event.clientY);
    gesture.current = moved.state;
    setDrag(moved.offset);
    // 判定为横滑后捕获指针：手指滑出这一行也继续收到事件，不会中途断掉。
    if (moved.axis === 'x') {
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 老浏览器忽略 */ }
    }
  };

  const handlePointerEnd = () => {
    if (!gesture.current) return;
    const shouldOpen = gesture.current.axis === 'x' ? endSwipe(offset) : isOpen;
    gesture.current = null;
    setDrag(null);
    (shouldOpen ? onOpen : onClose)();
  };

  const dragging = drag !== null;

  return (
    <article className={`minetab-book minetab-swipe${isOpen ? ' is-open' : ''}`}>
      <div
        className="minetab-swipe-body"
        style={{
          transform: `translateX(${offset}px)`,
          // 跟手时不要过渡，否则每一帧都在追一个正在移动的目标，手感发黏；
          // 松手后才用过渡做吸附。用状态控制而不是 :active，避免指针捕获期间
          // 伪类不生效导致两边判断不一致。
          transition: dragging ? 'none' : 'transform 0.22s cubic-bezier(0.22, 0.61, 0.36, 1)',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        {children}
      </div>
      <button
        type="button"
        className="minetab-swipe-delete"
        onClick={onDelete}
        disabled={deleting}
        tabIndex={isOpen ? 0 : -1}
        aria-hidden={!isOpen}
        aria-label={`从阅读历史中删除《${item.title}》`}
      >
        {deleting ? '删除中' : '删除'}
      </button>
    </article>
  );
}

// 单个条目行。value 为空时只显示右侧箭头。accent 用于“作者中心”指向。
// 不可点的占位行（余额 / 充值）不画 ›：箭头是「点进去有下一屏」的承诺，
// 画了却按不动，比没有反馈更让人以为是页面坏了。按压与悬停反馈同样只留给
// 可点的行（见 MineTab.css 里 .minetab-row:disabled 一组规则）。
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
        {!disabled && <span className="minetab-row-arrow" aria-hidden="true">›</span>}
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
  const [openingBookId, setOpeningBookId] = useState(null);
  // 一次最多展开一条；正在删除的那条禁止重复触发。
  const [openSwipeId, setOpenSwipeId] = useState(null);
  const [deletingBookId, setDeletingBookId] = useState(null);
  const [itemError, setItemError] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  // 上传成功前先用本地预览顶上，让点击立刻有反馈。
  const [localAvatar, setLocalAvatar] = useState('');
  const avatarInput = useRef(null);
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

  // 回到「我的」主页时刷新一次资料。
  //
  // profile 只在会话加载或登录时取过一次，而阅读、收藏都是在别的 Tab 里改服务端
  // 数据的，没人回来更新这份缓存——于是「阅读历史 0 篇」和点进去真有记录会长期
  // 打架。放在这里而不是每次读完文章后刷新：进入这一页是唯一真正需要看到准确
  // 数字的时刻，也顺带覆盖了在别处（甚至另一台设备）产生的变化。
  useEffect(() => {
    if (view !== 'mine') return;
    (async () => { await refreshProfile(); })();
  }, [view, refreshProfile]);

  async function openCollection(kind) {
    setView(kind); setItems([]); setLoadingItems(true); setItemError('');
    setOpenSwipeId(null);
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

  // 删除一条阅读历史。乐观移除 + 失败回插：等接口回来再动列表会让点击像没反应，
  // 而删除本身是幂等的，失败时把那条放回原位即可。
  async function removeHistory(bookId) {
    if (deletingBookId !== null) return;
    const index = items.findIndex((item) => item.book_id === bookId);
    if (index === -1) return;
    const removed = items[index];

    setDeletingBookId(bookId);
    setItemError('');
    setItems((current) => current.filter((item) => item.book_id !== bookId));
    setOpenSwipeId(null);
    try {
      await readerApi.deleteHistory(bookId);
      await refreshProfile();   // 让「阅读历史 N 篇」立刻同步
    } catch (error) {
      setItems((current) => {
        const restored = [...current];
        restored.splice(Math.min(index, restored.length), 0, removed);
        return restored;
      });
      setItemError(error.detail || error.message || '删除失败，请稍后再试');
    } finally {
      setDeletingBookId(null);
    }
  }

  async function saveName() {
    if (!displayName.trim()) return;
    setSavingName(true); setItemError('');
    try { await updateProfile(displayName.trim()); setView('mine'); }
    catch (error) { setItemError(error.detail || error.message || '昵称保存失败'); }
    finally { setSavingName(false); }
  }

  // 就地改名：失焦或回车即提交。没改动就直接退出编辑，不白打一次接口。
  async function commitName() {
    const next = displayName.trim();
    setEditingName(false);
    if (!next || next === (profile?.display_name || '')) return;
    setSavingName(true); setItemError('');
    try {
      await updateProfile(next);
    } catch (error) {
      setItemError(error.detail || error.message || '昵称保存失败');
    } finally { setSavingName(false); }
  }

  // 换头像：本地压成 256 方图再传，并先用本地预览顶上，失败再撤回。
  // 上传体积从几 MB 降到 20KB 上下，弱网下这一步比任何服务端优化都管用。
  async function changeAvatar(file) {
    if (avatarBusy) return;
    const invalid = validateAvatarFile(file);
    if (invalid) { setItemError(invalid); return; }

    setAvatarBusy(true); setItemError('');
    let preview = '';
    try {
      const compressed = await compressAvatar(file);
      preview = URL.createObjectURL(compressed);
      setLocalAvatar(preview);
      await readerApi.uploadAvatar(compressed);
      await refreshProfile();      // 换成服务端那份，跨设备一致
      setLocalAvatar('');
    } catch (error) {
      setLocalAvatar('');
      setItemError(error.detail || error.message || '头像上传失败，请重试');
    } finally {
      if (preview) URL.revokeObjectURL(preview);
      setAvatarBusy(false);
    }
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

  async function openBook(item) {
    if (openingBookId !== null) return;
    setReadingOrigin(view);
    setOpeningBookId(item.book_id);
    setItemError('');
    try {
      setCurrentBook(await hydrateArticle(item));
      setView('reading');
    } catch (error) {
      setItemError(error?.detail || error?.message || '正文读取失败，请稍后再试');
    } finally {
      setOpeningBookId(null);
    }
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
        respectTopSafeArea
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
      {view === 'history' && items.length > 0 && (
        <div className="minetab-hint">← 左滑一条可以删除</div>
      )}
      {/* 这里刻意没有容器级的 onClick。之前挂过一个「点空白处收起」，它会和删除
          按钮的点击抢同一次事件：手指稍微偏出按钮就变成收起，看起来就是「点了删除
          没反应」。现在收起只由行本身负责——有任何一行展开时，点哪一行都是先收起。 */}
      <div className="minetab-books">{items.map((item) => {
        const opened = openSwipeId === item.book_id;
        const anyOpen = openSwipeId !== null;
        const card = (
          <button
            type="button"
            className="minetab-book-open"
            // 有行展开时，点任意一行都只收起，不误开正文。
            onClick={anyOpen ? () => setOpenSwipeId(null) : () => openBook(item)}
            disabled={openingBookId !== null || deletingBookId === item.book_id}
            aria-label={anyOpen ? '收起删除按钮' : `打开《${item.title}》继续阅读`}
          >
            <div data-protected-image="true" className="minetab-book-cover" style={item.cover_image_url ? { backgroundImage: `url(${item.cover_image_url})` } : undefined} />
            <div className="minetab-book-main"><div className="minetab-book-title">{item.title}</div><div className="minetab-book-author">文 / {item.author}</div>{openingBookId === item.book_id && <div className="minetab-book-author">正在打开…</div>}{view === 'history' && <div className="minetab-progress"><span style={{ width: `${item.progress_percent || 0}%` }} /></div>}</div>
          </button>
        );

        if (view === 'history') {
          return (
            <SwipeableHistoryRow
              key={item.book_id}
              item={item}
              isOpen={opened}
              deleting={deletingBookId === item.book_id}
              onOpen={() => setOpenSwipeId(item.book_id)}
              onClose={() => setOpenSwipeId((current) => (current === item.book_id ? null : current))}
              onDelete={() => removeHistory(item.book_id)}
            >
              {card}
            </SwipeableHistoryRow>
          );
        }

        return (
          <article className="minetab-book" key={item.book_id}>
            {card}
            <button className="minetab-remove" onClick={() => removeFavorite(item.book_id)}>取消收藏</button>
          </article>
        );
      })}</div>
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
  const avatarUrl = localAvatar || profile?.avatar_url || '';

  return (
    <div className="minetab-root">
      <div className="minetab-content">

        {/* 头像 + 笔名 + 读者天数 —— 无独立报头。头像与笔名都可就地修改。 */}
        <header className="minetab-id">
          <button
            type="button"
            className="minetab-avatar"
            onClick={() => avatarInput.current?.click()}
            disabled={avatarBusy}
            aria-label={avatarUrl ? '更换头像' : '上传头像'}
          >
            {avatarUrl
              ? <img src={avatarUrl} alt="" className="minetab-avatar-img" />
              : <span aria-hidden="true">{name.slice(0, 1)}</span>}
          </button>
          <input
            ref={avatarInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';    // 允许连选同一张重试
              if (file) changeAvatar(file);
            }}
          />

          <div className="minetab-id-text">
            {editingName ? (
              <input
                className="minetab-name-input"
                value={displayName}
                maxLength={40}
                autoFocus
                enterKeyHint="done"
                onChange={(event) => setDisplayName(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') { setEditingName(false); setItemError(''); }
                }}
                aria-label="修改昵称"
              />
            ) : (
              <button
                type="button"
                className="minetab-name"
                onClick={() => { setDisplayName(name); setItemError(''); setEditingName(true); }}
                aria-label={`修改昵称，当前为 ${name}`}
              >
                {savingName ? '保存中…' : name}
              </button>
            )}
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
