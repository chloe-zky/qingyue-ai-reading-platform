// MineTab.jsx — “我的”页（读者 / 作者合并入口）。
// 按《作者端交付说明.md》第 2 节实现：
//   · 无分区标题、无独立报头，所有条目平铺为一列；
//   · 头像 + 笔名 + 读者天数，整屏垂直居中、重心略偏上；
//   · “作者中心”为点睛色 · 浅底强调行，点击进入既有作者中心（AuthorPage）。
//
// 仅负责“我的”一页。底部 Tab 栏（UserApp）与作者中心（AuthorPage）均不改动。

import { useState } from 'react';
import AuthorCenter from './author/AuthorCenter';
import './MineTab.css';

// 无账户系统，展示值取自交付说明的原型占位数据。
const PROFILE = {
  name:       'Cloe',   // 笔名
  readerDays: 214,
  balance:    '¥ 32.00',
  favorites:  '18 篇',
};

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
function ProfileRow({ label, value, onClick, accent = false }) {
  return (
    <button
      type="button"
      className={`minetab-row${accent ? ' is-accent' : ''}`}
      onClick={onClick}
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
  const [view, setView] = useState('mine');

  // 作者中心：以全屏浮层打开 AuthorCenter（进入页 → 稿件 → 投稿四步 → 回执 / 查询）。
  // 浮层自带顶栏与「我的」返回；退出浮层回到本页。底部 Tab 栏代码不改动，仅被浮层遮住。
  if (view === 'author') {
    return <AuthorCenter onExit={() => setView('mine')} userName={PROFILE.name} />;
  }

  return (
    <div className="minetab-root">
      <div className="minetab-content">

        {/* 头像 + 笔名 + 读者天数 —— 无独立报头 */}
        <header className="minetab-id">
          <div className="minetab-avatar" aria-hidden="true">
            {PROFILE.name.slice(0, 1)}
          </div>
          <div className="minetab-id-text">
            <div className="minetab-name">{PROFILE.name}</div>
            <div className="minetab-days">读者 · 第 {PROFILE.readerDays} 天</div>
          </div>
          <Bird size={30} style={{ position: 'absolute', top: 4, right: 2, color: 'var(--mt-ink-4)' }} />
        </header>

        {/* 条目一列平铺，无分区标题 */}
        <div className="minetab-group">
          <ProfileRow label="余额"   value={PROFILE.balance} />
          <ProfileRow label="充值"   value="" />
          <ProfileRow label="收藏"   value={PROFILE.favorites} />
          <ProfileRow label="阅读历史" value="" />
          <ProfileRow
            label="作者中心"
            value="投稿 · 查询"
            accent
            onClick={() => setView('author')}
          />
          <ProfileRow label="账号与安全" value="" />
          <ProfileRow label="退出登录" value="" onClick={onExit} />
        </div>

      </div>
    </div>
  );
}
