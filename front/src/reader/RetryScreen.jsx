// reader/RetryScreen.jsx — 今日发现状态读不到时的可重试错误页。
//
// 存在的理由是产品语义：「今天还没选过」和「这次没请求成功」必须长得不一样。
// 前者进三步选择，后者只能停在这里等重试 —— 否则一次网络抖动会让用户重新
// 选一遍，把当天已经保存好的选择覆盖掉。

import { PaperBg, Eyebrow, TopInset, BottomInset } from './shared.jsx';

export function RetryScreen({ theme, title, message, onRetry, retryLabel = '重试' }) {
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
            fontSize: 19,
            fontWeight: theme.weights.stepTitle,
            color: theme.ink,
            lineHeight: 1.5,
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
              letterSpacing: '0.02em',
            }}>
              {message}
            </div>
          )}

          <button
            onClick={onRetry}
            style={{
              marginTop: 34,
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
            {retryLabel} →
          </button>
        </div>

        <BottomInset />
      </div>
    </PaperBg>
  );
}
