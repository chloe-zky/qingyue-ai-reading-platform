// reader/shared.jsx — shared atoms used across all reader screens.

import { useState } from 'react';

export function PaperBg({ theme, children, scrollRef }) {
  return (
    <div
      ref={scrollRef}
      style={{
        position: 'absolute', inset: 0,
        background: theme.bg,
        transition: 'background 320ms ease',
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {/* Inner is a flex column with min-height:100% — this is what
          actually makes StepScreen's flex:1 child fill the viewport.
          Round 3 used min-height:100% alone, but percentage min-height
          on a child of an auto-height parent computes to 0 on Safari. */}
      <div style={{
        position: 'relative',
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {children}
      </div>
    </div>
  );
}

export function Eyebrow({ theme, children, align = 'left' }) {
  return (
    <div style={{
      fontFamily: theme.sans,
      fontSize: 11,
      fontWeight: theme.weights.eyebrow,
      color: theme.inkLight,
      letterSpacing: '0.18em',
      lineHeight: 1.4,
      textAlign: align,
    }}>
      — {children} —
    </div>
  );
}

export function Divider({ theme, style = {} }) {
  return <div style={{ height: 1, background: theme.divider, ...style }} />;
}

export function CoverImage({ theme, src, alt = '', height = 220 }) {
  const [errored, setErrored] = useState(false);

  // Slightly raised card look — gentle rounded corners + one soft shadow.
  const cardStyle = {
    width: '100%', height,
    borderRadius: 6,
    display: 'block',
    flexShrink: 0,
    boxShadow: '0 6px 16px -6px rgba(20, 18, 14, 0.10)',
  };

  if (!src || errored) {
    return (
      <div style={{
        ...cardStyle,
        background: theme.bg2,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ width: 10, height: 10, background: theme.accent, opacity: 0.5 }} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      width={720}
      height={Math.round(height * 2)}
      onError={() => setErrored(true)}
      style={{
        ...cardStyle,
        objectFit: 'cover',
      }}
    />
  );
}

export function WarmToggle({ theme, on, onToggle }) {
  return (
    <button
      onClick={onToggle}
      title="护眼模式"
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        padding: '4px 4px',
        display: 'flex', alignItems: 'center', gap: 6,
      }}
    >
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
        <circle
          cx="7" cy="7" r="5.5"
          stroke={on ? theme.accent : theme.inkLight}
          strokeWidth="0.7"
        />
        <path
          d="M 7 1.5 A 5.5 5.5 0 0 1 7 12.5 Z"
          fill={on ? theme.accent : 'none'}
          opacity={on ? 0.85 : 0}
        />
      </svg>
      <span style={{
        fontFamily: theme.sans,
        fontSize: 10,
        fontWeight: theme.weights.eyebrow,
        color: theme.inkLight,
        letterSpacing: '0.14em',
      }}>
        护眼
      </span>
    </button>
  );
}

export function ListIntro({ theme, text }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
      <div style={{
        width: 1,
        background: theme.accent,
        opacity: 0.35,
        flexShrink: 0,
      }} />
      <div style={{
        fontFamily: theme.sans,
        fontSize: 13.5,
        fontWeight: theme.weights.intro,
        color: theme.inkLight,
        lineHeight: 1.8,
        letterSpacing: '0.02em',
        textWrap: 'pretty',
      }}>
        {text}
      </div>
    </div>
  );
}

// 扉页语竖排。注意：writing-mode 为 vertical-* 时，maxHeight 不是盒子高度，
// 而是「每列能排多少字」（竖排下高度方向即行内方向），所以这个上限必须保留——
// 去掉会让整段排成一根很长的单列。
const INTRO_FONT_SIZE = 14;
const INTRO_LETTER_SPACING = 0.1;                                   // em
const INTRO_COLUMN_CAP = 152;                                       // 单列最长（px）
const INTRO_CHAR_ADVANCE = INTRO_FONT_SIZE * (1 + INTRO_LETTER_SPACING);

/**
 * 把列长上限收敛成「均分」后的值：先按设计上限算出需要几列，
 * 再让这几列平分字数，避免最后一列只剩一两个字孤悬、各列高度参差。
 * 例：28 字原为 9+9+8+2（末列孤悬“了。”），均分后为 7+7+7+7。
 */
function balancedColumnCap(length) {
  const perColumn = Math.max(1, Math.floor(INTRO_COLUMN_CAP / INTRO_CHAR_ADVANCE));
  if (length <= perColumn) return INTRO_COLUMN_CAP;                 // 单列，保持原样
  const columns = Math.ceil(length / perColumn);
  return Math.ceil(Math.ceil(length / columns) * INTRO_CHAR_ADVANCE) + 2;
}

// 拉丁文正文字体。项目里 MineTab 的数字栈已经以 EB Garamond 打头，
// 这里沿用同一族，保证中英两种扉页语出自同一套审美，而不是各挑各的。
const LATIN_SERIF = '"EB Garamond", "Iowan Old Style", Palatino, Georgia, "Times New Roman", serif';

/**
 * 判断扉页语是不是以拉丁文为主。
 *
 * 竖排 + text-orientation:upright 是给汉字用的：英文进去会把每个字母都立起来
 * 竖着摞，「Find you, love you」变成一列散字，完全读不了。
 */
function isLatinIntro(text) {
  let cjk = 0;
  let latin = 0;
  for (const ch of text) {
    if (ch >= '一' && ch <= '鿿') cjk += 1;
    else if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) latin += 1;
  }
  return latin > cjk;
}

/** 拉丁文扉页语：横排、拉丁衬线、斜体，保留左侧那条点睛色细线。 */
function LatinIntro({ theme, text }) {
  return (
    <div style={{ padding: '24px 24px 28px' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
        <div style={{
          width: 0.5,
          background: theme.accent,
          opacity: 0.5,
          flexShrink: 0,
        }} />
        <div style={{
          fontFamily: LATIN_SERIF,
          fontSize: 16,
          fontStyle: 'italic',
          // 不沿用 theme.weights.intro 的 300：那是按汉字笔画密度定的，
          // 拉丁衬线在 300 下发虚，而且多数衬线体没有 300 斜体，会退化或被合成。
          fontWeight: 400,
          color: theme.inkSoft,
          lineHeight: 1.75,
          // 汉字那 0.1em 的字距是为了竖排呼吸感；拉丁文照搬会把单词拆散，
          // 这里回到接近默认的字距。
          letterSpacing: '0.01em',
          textWrap: 'pretty',
          maxWidth: '32em',
        }}>
          {text}
        </div>
      </div>
    </div>
  );
}

export function VerticalIntro({ theme, text }) {
  const content = String(text ?? '');
  if (content && isLatinIntro(content)) {
    return <LatinIntro theme={theme} text={content} />;
  }
  return (
    <div style={{ padding: '24px 24px 28px' }}>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: -12,
          width: 0.5,
          background: theme.accent,
          opacity: 0.5,
        }} />
        <div style={{
          writingMode: 'vertical-lr',
          textOrientation: 'upright',
          fontFamily: theme.sans,
          fontSize: INTRO_FONT_SIZE,
          fontWeight: theme.weights.intro,
          color: theme.inkSoft,
          lineHeight: 2.6,
          letterSpacing: `${INTRO_LETTER_SPACING}em`,
          maxHeight: balancedColumnCap(content.length),
        }}>
          {content}
        </div>
      </div>
    </div>
  );
}

export function TopInset({ theme }) {
  return (
    <div className={theme.__inFrame ? 'reader-top-inset-frame' : 'reader-top-inset-mobile'} />
  );
}

export function BottomInset() {
  return <div style={{ height: 60 }} />;
}
