// reader/ListScreen.jsx — recommended article list.
// Receives real API results via props; never fetches data itself.
// Shows: cover image, title, author, intro (扉页语), 进入阅读 button.
// Does NOT show: score, matched_tags, recommend_reason, AI labels.

import { useEffect, useRef } from 'react';
import { PaperBg, Divider, CoverImage, ListIntro, TopInset, BottomInset } from './shared.jsx';

const PAGE_SIZE = 3;
const ORDINALS  = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function ordinal(n) {
  return ORDINALS[n] ?? String(n + 1);
}

// ── Top action row ─────────────────────────────────────────────────────────
// One quiet action, given its own band above the masthead. The underline under
// the label is the same affordance the 首页 CTA uses, so the row reads as a
// deliberate header action rather than a stray link; the air below it (see the
// masthead's top padding) is what actually keeps it off the 轻阅读 title.
function BackRow({ theme, onBack, label = '返回' }) {
  return (
    <div style={{ padding: '0 24px' }}>
      <button
        onClick={onBack}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: 0,
          // The 44px tap target stays, but its content rides at the top of it:
          // that lifts the label clear of the masthead without eating into the
          // status-bar safe area above (TopInset), which is already minimal.
          display: 'flex', alignItems: 'flex-start', gap: 6,
          minHeight: 44,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {/* 14px glyph against a ~14.4px text line — top-aligning the two leaves
            the chevron optically centred on the label, above the rule. */}
        <svg width="9" height="14" viewBox="0 0 10 16" fill="none">
          <path d="M8 2L2 8l6 6"
            stroke={theme.ink} strokeWidth="1.1"
            strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
        <span style={{
          fontFamily: theme.sans,
          fontSize: 12,
          fontWeight: theme.weights.body,
          color: theme.ink,
          letterSpacing: '0.06em',
          paddingBottom: 3,
          borderBottom: `1px solid ${theme.divider}`,
        }}>
          {label}
        </span>
      </button>
    </div>
  );
}

// ── Empty / error fallback ─────────────────────────────────────────────────
function EmptyState({ theme, error, onBack, backLabel }) {
  return (
    <PaperBg theme={theme}>
      <TopInset theme={theme} />
      <BackRow theme={theme} onBack={onBack} label={backLabel} />
      <div style={{
        padding: '40px 24px',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12,
      }}>
        <div style={{
          fontFamily: theme.sans, fontSize: 11,
          fontWeight: theme.weights.eyebrow,
          color: theme.inkLight, letterSpacing: '0.18em',
        }}>
          — 轻阅读 —
        </div>
        <div style={{
          fontFamily: theme.serif, fontSize: 17,
          fontWeight: theme.weights.listTitle,
          color: theme.ink, lineHeight: 1.6,
        }}>
          {error ? '暂时无法加载，请稍后再试' : '暂无推荐结果'}
        </div>
        {error && (
          <div style={{
            fontFamily: theme.sans, fontSize: 12,
            fontWeight: theme.weights.body,
            color: theme.inkLight,
          }}>
            {error}
          </div>
        )}
      </div>
    </PaperBg>
  );
}

// ── Main list ─────────────────────────────────────────────────────────────
export function ListScreen({
  theme, articles, error, page, onPage, onOpen, onBack,
  backLabel, notice,
}) {
  // 翻辑后回到页首。翻页按钮在页面底部，而换辑只是换了内容、并没有换 DOM
  // 节点，滚动位置会原样留在底部——于是「下一辑」看起来像直接落到了新一辑的
  // 末尾。这里在 page 变化后把滚动容器拉回顶部。
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [page]);

  if (!articles || (articles.length === 0)) {
    return (
      <EmptyState theme={theme} error={error} onBack={onBack} backLabel={backLabel} />
    );
  }

  const totalPages = Math.ceil(articles.length / PAGE_SIZE);
  const slice      = articles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <PaperBg theme={theme} scrollRef={scrollRef}>
      <TopInset theme={theme} />

      <BackRow theme={theme} onBack={onBack} label={backLabel} />

      {/* Masthead — the 18px band below the action row is deliberate breathing
          space; without it the 重选今日偏好 label sits right on the title. */}
      <div style={{ padding: '18px 24px 0' }}>
        <div style={{
          fontFamily: theme.serif,
          fontSize: 18,
          fontWeight: theme.weights.masthead,
          color: theme.ink,
          letterSpacing: '0.04em',
        }}>
          轻阅读
        </div>
        <div style={{
          marginTop: 3,
          fontFamily: theme.sans,
          fontSize: 11,
          fontWeight: theme.weights.body,
          color: theme.inkLight,
          letterSpacing: '0.1em',
        }}>
          二〇二六年五月 · 第{ordinal(page)}辑
        </div>

        {/* Server-authored notice — set when the backend had to top the page up
            with nearest-match candidates instead of exact tag matches. */}
        {notice && (
          <div style={{
            marginTop: 10,
            fontFamily: theme.sans,
            fontSize: 11.5,
            fontWeight: theme.weights.body,
            color: theme.inkLight,
            lineHeight: 1.7,
            letterSpacing: '0.02em',
          }}>
            {notice}
          </div>
        )}
      </div>

      <Divider theme={theme} style={{ margin: '18px 24px 0' }} />

      {/* Article entries */}
      <div style={{ padding: '0 24px' }}>
        {slice.map((article, i) => {
          const isLast = i === slice.length - 1;

          return (
            <div
              key={article.book_id}
              style={{
                paddingTop: 28,
                paddingBottom: 32,
                borderBottom: isLast ? 'none' : `1px solid ${theme.divider}`,
              }}
            >
              <div style={{
                fontFamily: theme.serif,
                fontSize: 19,
                fontWeight: theme.weights.listTitle,
                color: theme.ink,
                lineHeight: 1.4,
                letterSpacing: '0.02em',
              }}>
                {article.title}
              </div>

              <div style={{
                marginTop: 4,
                fontFamily: theme.sans,
                fontSize: 11,
                fontWeight: theme.weights.body,
                color: theme.inkLight,
                letterSpacing: '0.04em',
              }}>
                文 / {article.author}
              </div>

              {article.intro ? (
                <div style={{ marginTop: 14 }}>
                  <ListIntro theme={theme} text={article.intro} />
                </div>
              ) : null}

              <div style={{ marginTop: 18 }}>
                <CoverImage
                  theme={theme}
                  src={article.cover_image_url}
                  alt={article.title}
                  height={220}
                />
                {(article.cover_photographer || article.cover_caption) && (
                  <div style={{ marginTop: 8 }}>
                    {article.cover_photographer && (
                      <div style={{
                        fontFamily: theme.sans,
                        fontSize: 10.5,
                        fontWeight: theme.weights.body,
                        color: theme.inkLight,
                        letterSpacing: '0.12em',
                      }}>
                        摄影 / {article.cover_photographer}
                      </div>
                    )}
                    {article.cover_caption && (
                      <div style={{
                        marginTop: 4,
                        fontFamily: theme.serif,
                        fontSize: 12,
                        fontWeight: theme.weights.body,
                        color: theme.inkSoft,
                        lineHeight: 1.7,
                        letterSpacing: '0.02em',
                        fontStyle: 'italic',
                      }}>
                        {article.cover_caption}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => onOpen(article)}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontFamily: theme.sans,
                    fontSize: 12,
                    fontWeight: theme.weights.body,
                    color: theme.inkSoft,
                    letterSpacing: '0.08em',
                    padding: 0,
                    minHeight: 44,
                    display: 'flex', alignItems: 'center',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  进入阅读 →
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Divider theme={theme} style={{ margin: '0 24px' }} />

      {/* Pagination — always shown; buttons disable themselves when at edge */}
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        gap: 18, padding: '22px 24px 0',
        fontFamily: theme.sans,
        fontSize: 11,
        fontWeight: theme.weights.body,
        color: theme.inkSoft,
      }}>
        <button
          onClick={() => onPage(Math.max(0, page - 1))}
          disabled={page === 0}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit',
            color: page === 0 ? theme.inkLight : theme.ink,
            opacity: page === 0 ? 0.4 : 1,
            padding: 0, letterSpacing: '0.08em',
            minHeight: 44, display: 'flex', alignItems: 'center',
          }}
        >
          ← 上一辑
        </button>

        <span style={{ letterSpacing: '0.14em' }}>
          第{ordinal(page)}辑 / 共{ordinal(totalPages - 1)}辑
        </span>

        <button
          onClick={() => onPage(Math.min(totalPages - 1, page + 1))}
          disabled={page >= totalPages - 1}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit',
            color: page >= totalPages - 1 ? theme.inkLight : theme.ink,
            opacity: page >= totalPages - 1 ? 0.4 : 1,
            padding: 0, letterSpacing: '0.08em',
            minHeight: 44, display: 'flex', alignItems: 'center',
          }}
        >
          下一辑 →
        </button>
      </div>

      <BottomInset />
    </PaperBg>
  );
}
