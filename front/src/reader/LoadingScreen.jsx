// reader/LoadingScreen.jsx — 翻页 metaphor. No spinner, no AI language.

import { useState, useEffect } from 'react';
import { PaperBg, Eyebrow, TopInset, BottomInset } from './shared.jsx';

const PHRASES = ['书页 · 一', '书页 · 二', '书页 · 三'];

export function LoadingScreen({ theme }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % PHRASES.length), 600);
    return () => clearInterval(t);
  }, []);

  return (
    <PaperBg theme={theme}>
      <TopInset theme={theme} />
      <div style={{
        height: 'calc(100% - 90px)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'flex-start', justifyContent: 'center',
        padding: '0 24px',
      }}>
        <Eyebrow theme={theme}>翻阅中</Eyebrow>
        <div style={{
          marginTop: 18,
          fontFamily: theme.serif,
          fontSize: 19,
          fontWeight: theme.weights.stepTitle,
          color: theme.ink,
          lineHeight: 1.5,
          letterSpacing: '0.04em',
        }}>
          正在为你翻阅⋯
        </div>
        <div style={{
          marginTop: 10,
          fontFamily: theme.sans,
          fontSize: 11,
          fontWeight: theme.weights.body,
          color: theme.inkLight,
          letterSpacing: '0.1em',
        }}>
          {PHRASES[idx]}
        </div>
        <div style={{
          marginTop: 60,
          position: 'relative',
          width: '100%', height: 1,
          background: theme.divider,
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0,
            width: '32%', height: '100%',
            background: theme.accent,
            animation: 'reader-scan 2400ms cubic-bezier(0.55,0.05,0.45,0.95) infinite',
          }} />
        </div>
      </div>
      <BottomInset />
    </PaperBg>
  );
}