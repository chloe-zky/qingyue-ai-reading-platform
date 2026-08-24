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

export function VerticalIntro({ theme, text }) {
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
          fontSize: 14,
          fontWeight: theme.weights.intro,
          color: theme.inkSoft,
          lineHeight: 2.6,
          letterSpacing: '0.1em',
          maxHeight: 152,
        }}>
          {text}
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