// reader/SearchBar.jsx — 发现页顶部的作品/作者搜索栏。
//
// 沿用发现页既有的视觉语汇：不画框，只留一条细线；字号与眉标同级；
// 点睛色只在输入时的下划线上出现一次，不额外引入新的强调色。

import { PaperBg, Eyebrow, TopInset, BottomInset } from './shared.jsx';

function Glass({ theme }) {
  // 与返回箭头同一套线条参数（1.1 描边、圆头圆角），保证同源感。
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.6" stroke={theme.inkLight} strokeWidth="1.1" />
      <path d="M10.6 10.6 L14 14" stroke={theme.inkLight} strokeWidth="1.1"
            strokeLinecap="round" />
    </svg>
  );
}

// top / height 由 ReaderPage 决定：那里才知道下方屏幕要让开多少。
// 搜索栏自己不加任何安全区内边距——外层 .reader-mobile-wrapper 已经加过一次
// env(safe-area-inset-top)，再加一次会让整条栏在刘海机上凭空下移约 47px。
//
// hidden：向下滚动时整条收折上去。只动 transform，不改任何布局，所以下方内容
// 不会跟着重排——滚动中最忌讳的就是布局抖动。
//
// onFocus / onBlur：光标在框里时，ReaderPage 那边要停掉自动收折的时钟——
// 正打字打到一半整条栏收上去是最难受的一种。
export function SearchBar({
  theme, value, onChange, onClear, active, top = 0, height = 44, hidden = false,
  onFocus, onBlur,
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top, left: 0, right: 0,
        zIndex: 5,
        background: theme.bg,
        transform: hidden ? `translateY(-${top + height + 8}px)` : 'translateY(0)',
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? 'none' : 'auto',
        transition: 'transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1),'
          + ' opacity 200ms ease, background 320ms ease',
        willChange: 'transform',
      }}
    >
      <div style={{
        height,
        margin: '0 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: `1px solid ${active ? theme.accent : theme.divider}`,
        transition: 'border-color 200ms ease',
      }}>
        <Glass theme={theme} />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder="搜作品或作者"
          aria-label="搜索作品或作者"
          enterKeyHint="search"
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: theme.sans,
            fontSize: 13,
            fontWeight: theme.weights.body,
            color: theme.ink,
            letterSpacing: '0.04em',
            // iOS 会把 type=search 画成圆角灰底，与这套克制的线条语言冲突。
            WebkitAppearance: 'none',
            appearance: 'none',
          }}
        />
        {value && (
          <button
            type="button"
            onClick={onClear}
            aria-label="清除搜索"
            style={{
              flex: '0 0 auto',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '0 2px',
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              fontFamily: theme.sans,
              fontSize: 15,
              color: theme.inkLight,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 搜索的「没找到 / 出错」画面。
 *
 * 不复用列表页的空状态：那句「暂无推荐结果」说的是推荐，会让用户以为是
 * 推荐坏了而不是这个词没搜到。
 */
export function SearchNotice({ theme, title, message, onClear }) {
  return (
    <PaperBg theme={theme}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <TopInset theme={theme} />
        <div style={{
          flex: 1,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: '0 24px',
        }}>
          <Eyebrow theme={theme}>轻阅读</Eyebrow>
          <div style={{
            marginTop: 18,
            fontFamily: theme.serif,
            fontSize: 17,
            fontWeight: theme.weights.listTitle,
            color: theme.ink,
            lineHeight: 1.6,
            letterSpacing: '0.02em',
          }}>
            {title}
          </div>
          {message && (
            <div style={{
              marginTop: 10,
              fontFamily: theme.sans,
              fontSize: 12,
              fontWeight: theme.weights.body,
              color: theme.inkLight,
              lineHeight: 1.7,
            }}>
              {message}
            </div>
          )}
          <button
            onClick={onClear}
            style={{
              marginTop: 30,
              alignSelf: 'flex-start',
              background: 'transparent',
              border: 'none',
              borderBottom: `1px solid ${theme.ink}`,
              cursor: 'pointer',
              fontFamily: theme.serif,
              fontSize: 14,
              fontWeight: theme.weights.stepTitle,
              color: theme.ink,
              padding: '6px 2px',
              letterSpacing: '0.06em',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            回到今日推荐 →
          </button>
        </div>
        <BottomInset />
      </div>
    </PaperBg>
  );
}
