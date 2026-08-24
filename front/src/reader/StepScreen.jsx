// reader/StepScreen.jsx — 3-step preference selection.
// Question + option list centred vertically, like a 卷首页.
// Top row: progress bar (left) + 跳过 (right, skips ALL steps).
// Bottom row: ← 上一卷 (left, hidden on step 0) + 下一卷 → (right).

import { PaperBg, Eyebrow, TopInset, BottomInset } from './shared.jsx';

export function StepScreen({ theme, steps, stepIndex, selected, onToggle, onNext, onSkip, onBack }) {
  const step  = steps[stepIndex];
  const total = steps.length;

  const segments = steps.map((_, i) => i <= stepIndex);
  const eyebrowLabel = step.eyebrow.replace(/^STEP \d+\s*·\s*/i, '');
  const isFirst = stepIndex === 0;

  return (
    <PaperBg theme={theme}>
      {/*
       * flex:1 wrapper — fills PaperBg's flex column so the flex:1 middle
       * section can centre its content vertically. Bottom nav stays pinned.
       */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <TopInset theme={theme} />

        {/* Top row — progress (left, 42%) + 跳过 (right) */}
        <div style={{
          padding: '8px 24px 0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12,
        }}>
          <div style={{ display: 'flex', gap: 6, width: '42%' }}>
            {segments.map((filled, i) => (
              <div key={i} style={{
                flex: 1, height: 1,
                background: filled ? theme.ink : theme.divider,
              }} />
            ))}
          </div>

          <button
            onClick={onSkip}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: theme.sans,
              fontSize: 12,
              fontWeight: theme.weights.body,
              color: theme.inkLight,
              padding: 0, letterSpacing: '0.06em',
              minHeight: 44, display: 'flex', alignItems: 'center',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            跳过 →
          </button>
        </div>

        {/* Centred content — eyebrow / question / options */}
        <div style={{
          flex: 1,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          paddingTop: 24, paddingBottom: 24,
        }}>
          <div style={{ padding: '0 24px' }}>
            <Eyebrow theme={theme}>{eyebrowLabel}</Eyebrow>
          </div>

          <div style={{
            padding: '14px 24px 0',
            fontFamily: theme.serif,
            fontSize: 20,
            fontWeight: theme.weights.stepTitle,
            lineHeight: 1.5,
            color: theme.ink,
            letterSpacing: '0.02em',
          }}>
            {step.question}
          </div>

          <div style={{ padding: '24px 24px 0' }}>
            {step.options.map((opt, i) => {
              const on = selected.includes(opt.label);
              return (
                <button
                  key={opt.label}
                  onClick={() => onToggle(opt.label)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: '15px 0',
                    borderTop: i === 0 ? `1px solid ${theme.divider}` : 'none',
                    borderBottom: `1px solid ${theme.divider}`,
                    position: 'relative',
                    fontFamily: 'inherit',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <div style={{
                    position: 'absolute', left: -14, top: 22,
                    width: 4, height: 4,
                    background: theme.accent,
                    opacity: on ? 1 : 0,
                    transition: 'opacity 160ms ease',
                  }} />

                  <div style={{
                    fontFamily: theme.serif,
                    fontSize: 16,
                    fontWeight: theme.weights.option,
                    color: theme.ink,
                    lineHeight: 1.4,
                    letterSpacing: '0.02em',
                  }}>
                    {opt.label}
                  </div>

                  <div style={{
                    marginTop: 4,
                    fontFamily: theme.sans,
                    fontSize: 12,
                    fontWeight: theme.weights.body,
                    color: theme.inkLight,
                    lineHeight: 1.55,
                    letterSpacing: '0.02em',
                  }}>
                    {opt.desc}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Bottom nav — ← 上一卷 (left, hidden on step 0) / 下一卷 → (right) */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0 24px 16px',
        }}>
          <button
            onClick={onBack}
            disabled={isFirst}
            aria-hidden={isFirst}
            style={{
              background: 'transparent', border: 'none',
              cursor: isFirst ? 'default' : 'pointer',
              fontFamily: theme.sans,
              fontSize: 12,
              fontWeight: theme.weights.body,
              color: theme.inkLight,
              padding: 0, letterSpacing: '0.06em',
              minHeight: 44, display: 'flex', alignItems: 'center',
              opacity: isFirst ? 0 : 1,
              pointerEvents: isFirst ? 'none' : 'auto',
              transition: 'opacity 200ms ease',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            ← 上一卷
          </button>
          <button
            onClick={onNext}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: theme.serif,
              fontSize: 14,
              fontWeight: theme.weights.stepTitle,
              color: theme.ink,
              padding: 0, letterSpacing: '0.06em',
              minHeight: 44, display: 'flex', alignItems: 'center',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {stepIndex === total - 1 ? '开始翻阅 →' : '下一卷 →'}
          </button>
        </div>

        <BottomInset />
      </div>
    </PaperBg>
  );
}
