// LandingPage.jsx — App entry / landing screen.
// 普通用户端入口：hero + 产品名 + 文案 + 登录/注册。
// 编辑 / 管理员入口不再以可见按钮形式出现——通过两种隐藏方式进入工作台：
//   (1) 独立模式：URL 带 `?mode=studio` 或 `#studio`（App.jsx 处理）
//   (2) 隐藏入口：本页面"— 轻 阅 读 —" eyebrow 在 2.5s 内被快速点击 5 次
//
// 登录 / 注册当前为 Demo —— 都跳到 UserApp。

import { useEffect, useRef } from 'react';
import { primeHomePick } from './homePickCache';
import heroImage from './assets/hero.png';
import './LandingPage.css';

// 隐藏入口阈值：N 次点击在 windowMs 内触发
const TAP_TRIGGER_COUNT = 5;
const TAP_WINDOW_MS     = 2500;

export default function LandingPage({ onNavigate }) {
  // 用 ref 避免触发重渲染——纯粹的累计计数
  const tapTimesRef = useRef([]);

  // 在用户还看着落地页时，悄悄把首页要展示的随机作品 + 封面预拉一次。
  // 这样点"登录"进 UserApp → 首页时，HomeTab 通常已能即刻渲染内容。
  useEffect(() => { primeHomePick(); }, []);

  const handleEyebrowTap = () => {
    const now  = Date.now();
    const keep = tapTimesRef.current.filter((t) => now - t < TAP_WINDOW_MS);
    keep.push(now);
    tapTimesRef.current = keep;
    if (keep.length >= TAP_TRIGGER_COUNT) {
      tapTimesRef.current = [];
      onNavigate('studio');
    }
  };

  return (
    <div className="landing-root">
      <div className="landing-frame">

        {/* Hero image */}
        <div
          className="landing-hero"
          style={{ backgroundImage: `url(${heroImage})` }}
        >
          <div className="landing-hero-veil" />
        </div>

        {/* Text block */}
        <div className="landing-body">
          {/* 隐藏入口：本行被快速点击 5 次进入工作台。视觉上与普通眉标无差异。 */}
          <div
            className="landing-eyebrow"
            onClick={handleEyebrowTap}
          >
            — 轻 阅 读 —
          </div>
          <h1 className="landing-title">轻阅读</h1>
          <p className="landing-tagline">
            今晚，读一篇刚好属于你的故事。
          </p>

          {/* Primary actions */}
          <div className="landing-actions">
            <button
              className="landing-btn landing-btn-primary"
              onClick={() => onNavigate('user')}
            >
              登录
            </button>
            <button
              className="landing-btn landing-btn-ghost"
              onClick={() => onNavigate('user')}
            >
              注册
            </button>
          </div>

        </div>

      </div>
    </div>
  );
}
