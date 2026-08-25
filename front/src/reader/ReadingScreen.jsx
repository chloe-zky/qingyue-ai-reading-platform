// reader/ReadingScreen.jsx — full article reading view.
// Shows: back ←, title, author, 扉页语 (vertical), cover, full_content, feedback.
// Nav bar fades in on scroll. Feedback section fades in at 55% scroll.
// Feedback POST to /api/feedback on submit.

import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../lib/apiClient.js';
import { readerApi } from '../lib/readerApi.js';
import { useReaderAuth } from './ReaderAuthContext.js';
import {
  PaperBg, Divider, VerticalIntro, WarmToggle, BottomInset,
} from './shared.jsx';

// ── Full-bleed cover (no crop) used on the reading page ────────────────────
// Reading page shows the photo at its natural aspect ratio — never crop the
// editor's chosen framing. Discover list still uses the cropped CoverImage.
function ReadingCover({ theme, src, alt }) {
  const [errored, setErrored] = useState(false);
  if (!src || errored) {
    return (
      <div style={{
        width: '100%', height: 220,
        background: theme.bg2,
        borderRadius: 2,
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
        width: '100%',
        height: 'auto',
        display: 'block',
        borderRadius: 2,
      }}
    />
  );
}

// Options match the enum the backend expects for `reason`
const FEEDBACK_OPTIONS = ['推荐准确', '不感兴趣', '标签不准', '风格不符'];

// ── Feedback section ───────────────────────────────────────────────────────
function FeedbackSection({ theme, article, requestId, userPrefs, visible }) {
  const [selected,   setSelected]   = useState(null);
  const [note,       setNote]       = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);
  const [submitError, setSubmitError] = useState('');

  const handleSubmit = async () => {
    if (!selected || submitting || submitted) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await apiFetch('/api/feedback', {
        method: 'POST',
        auth: 'optional-reader',
        body: {
          request_id:   requestId,
          book_id:      article.book_id,
          book_title:   article.title,
          reason:       selected,
          user_prefs:   userPrefs,
          feedback_note: note.trim(),
        },
      });
      setSubmitted(true);
    } catch (error) {
      setSubmitError(error.message || '反馈提交失败，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      padding: '32px 24px 0',
      opacity:   visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(6px)',
      transition: 'opacity 360ms ease, transform 360ms ease',
      pointerEvents: visible ? 'auto' : 'none',
    }}>
      <Divider theme={theme} style={{ marginBottom: 20 }} />

      {submitted ? (
        <div style={{
          fontFamily: theme.sans,
          fontSize: 11,
          fontWeight: theme.weights.body,
          color: theme.inkLight,
          letterSpacing: '0.1em',
          paddingBottom: 8,
        }}>
          感谢反馈
        </div>
      ) : (
        <>
          <div style={{
            display: 'flex', alignItems: 'center',
            gap: 14, flexWrap: 'wrap',
          }}>
            <span style={{
              fontFamily: theme.sans,
              fontSize: 11,
              fontWeight: theme.weights.body,
              color: theme.inkLight,
              letterSpacing: '0.08em',
            }}>
              这篇推荐合适吗
            </span>

            {FEEDBACK_OPTIONS.map((label) => {
              const on = selected === label;
              return (
                <button
                  key={label}
                  onClick={() => setSelected(label)}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontFamily: theme.sans,
                    fontSize: 11,
                    fontWeight: theme.weights.body,
                    color: on ? theme.ink : theme.inkLight,
                    padding: '2px 0',
                    position: 'relative',
                    letterSpacing: '0.06em',
                    transition: 'color 200ms ease',
                    minHeight: 44, display: 'flex', alignItems: 'center',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {label}
                  <div style={{
                    position: 'absolute',
                    bottom: -3, left: '50%', transform: 'translateX(-50%)',
                    height: 1,
                    width: on ? 14 : 0,
                    background: theme.accent,
                    transition: 'width 260ms cubic-bezier(0.32,0.72,0,1)',
                  }} />
                </button>
              );
            })}
          </div>

          {selected && (
            <div style={{ marginTop: 16 }}>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="也想说点什么（可选）"
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `1px solid ${theme.divider}`,
                  borderRadius: 0,
                  padding: '6px 0',
                  fontFamily: theme.sans,
                  fontSize: 13,
                  fontWeight: theme.weights.body,
                  color: theme.ink,
                  letterSpacing: '0.02em',
                  outline: 'none',
                  caretColor: theme.accent,
                }}
                className="reader-feedback-input"
              />
            </div>
          )}

          {selected && (
            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontFamily: theme.sans,
                  fontSize: 12,
                  fontWeight: theme.weights.body,
                  color: submitting ? theme.inkLight : theme.inkSoft,
                  letterSpacing: '0.08em',
                  padding: 0,
                  minHeight: 44, display: 'flex', alignItems: 'center',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {submitting ? '提交中…' : '提交'}
              </button>
            </div>
          )}
          {submitError && (
            <div style={{
              fontFamily: theme.sans,
              fontSize: 11,
              color: theme.accent,
              paddingBottom: 8,
            }}>
              {submitError}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Reading screen ─────────────────────────────────────────────────────────
export function ReadingScreen({ theme, article, requestId, userPrefs, onBack, warm, onToggleWarm }) {
  const { session, refreshProfile } = useReaderAuth();
  const bookId = article?.book_id;
  const scrollRef = useRef(null);
  const lastSavedProgress = useRef(-1);
  const progressRef = useRef(0);
  const pendingActiveSeconds = useRef(0);
  const lastInteractionAt = useRef(0);
  const flushInFlight = useRef(false);
  const [scrolled,  setScrolled]  = useState(false);
  const [progress,  setProgress]  = useState(0);
  const [favorite, setFavorite] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);

  const flushReadingProgress = useCallback(async ({ force = false, keepalive = false } = {}) => {
    if (!session || !bookId || flushInFlight.current) return;
    const percent = Math.max(0, Math.min(100, Math.round(progressRef.current * 100)));
    const activeSecondsDelta = pendingActiveSeconds.current;
    if (!force && activeSecondsDelta === 0 && percent < 85 && percent - lastSavedProgress.current < 5) return;
    pendingActiveSeconds.current = 0;
    flushInFlight.current = true;
    try {
      await readerApi.saveProgress(bookId, percent, {
        activeSecondsDelta,
        requestId,
        keepalive,
      });
      lastSavedProgress.current = Math.max(lastSavedProgress.current, percent);
    } catch {
      pendingActiveSeconds.current += activeSecondsDelta;
    } finally {
      flushInFlight.current = false;
    }
  }, [session, bookId, requestId]);

  useEffect(() => {
    if (!session || !article?.book_id) return;
    const initialPercent = Math.max(0, Math.min(100, Number(article.progress_percent) || 0));
    let alive = true;
    readerApi.favoriteState(article.book_id)
      .then((value) => { if (alive) setFavorite(Boolean(value.is_favorite)); })
      .catch(() => {});
    progressRef.current = initialPercent / 100;
    readerApi.saveProgress(article.book_id, initialPercent, {
      opened: true,
      requestId,
    }).catch(() => {});
    lastSavedProgress.current = initialPercent;
    return () => { alive = false; };
  }, [session, article?.book_id, article?.progress_percent, requestId]);

  useEffect(() => {
    const el = scrollRef.current;
    const initialPercent = Math.max(0, Math.min(100, Number(article?.progress_percent) || 0));
    if (!el || initialPercent <= 0) return undefined;

    const restore = () => {
      const max = el.scrollHeight - el.clientHeight;
      if (max > 0) el.scrollTop = max * initialPercent / 100;
    };
    restore();
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(restore);
    if (observer && el.firstElementChild) observer.observe(el.firstElementChild);
    const timer = window.setTimeout(restore, 400);
    const stopTimer = window.setTimeout(() => observer?.disconnect(), 1400);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(stopTimer);
      observer?.disconnect();
    };
  }, [article?.book_id, article?.progress_percent]);

  useEffect(() => {
    if (!session || !article?.book_id) return undefined;
    const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
    if (percent < 85 && percent - lastSavedProgress.current < 5) return undefined;
    const timer = setTimeout(() => { flushReadingProgress(); }, 700);
    return () => clearTimeout(timer);
  }, [progress, session, article?.book_id, flushReadingProgress]);

  useEffect(() => {
    if (!session || !article?.book_id) return undefined;
    lastInteractionAt.current = Date.now();
    const markInteraction = () => { lastInteractionAt.current = Date.now(); };
    const activeTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastInteractionAt.current <= 45000) {
        pendingActiveSeconds.current += 1;
      }
    }, 1000);
    const flushTimer = window.setInterval(() => {
      flushReadingProgress({ force: true });
    }, 30000);
    const handlePageHide = () => {
      flushReadingProgress({ force: true, keepalive: true });
    };
    const el = scrollRef.current;
    el?.addEventListener('pointerdown', markInteraction, { passive: true });
    el?.addEventListener('touchstart', markInteraction, { passive: true });
    window.addEventListener('keydown', markInteraction);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.clearInterval(activeTimer);
      window.clearInterval(flushTimer);
      el?.removeEventListener('pointerdown', markInteraction);
      el?.removeEventListener('touchstart', markInteraction);
      window.removeEventListener('keydown', markInteraction);
      window.removeEventListener('pagehide', handlePageHide);
      flushReadingProgress({ force: true, keepalive: true });
    };
  }, [session, article?.book_id, flushReadingProgress]);

  async function toggleFavorite() {
    if (!session || favoriteBusy) return;
    setFavoriteBusy(true);
    try {
      const next = favorite
        ? await readerApi.removeFavorite(article.book_id)
        : await readerApi.addFavorite(article.book_id);
      setFavorite(next.is_favorite);
      refreshProfile();
    } finally { setFavoriteBusy(false); }
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      setScrolled(el.scrollTop > 16);
      const nextProgress = max > 0 ? el.scrollTop / max : 0;
      progressRef.current = nextProgress;
      lastInteractionAt.current = Date.now();
      setProgress(nextProgress);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const showFeedback = progress > 0.55;

  // Only full_content is the body. sample is NOT the body — if full_content
  // is empty, show a placeholder line instead.
  const content    = (article?.full_content || '').trim();
  const paragraphs = content
    ? content
        .split(/\n{2,}/)
        .flatMap((block) => block.split('\n'))
        .filter((line) => line.trim().length > 0)
    : [];

  const navBg = scrolled
    ? warm ? 'rgba(251,248,242,0.96)' : 'rgba(246,246,243,0.96)'
    : 'transparent';

  const navTopPadding = theme.__inFrame ? 56 : 0;

  return (
    <>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
        paddingTop: navTopPadding,
        background: navBg,
        transition: 'background 240ms ease',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 24px 10px',
          borderBottom: scrolled ? `0.5px solid ${theme.divider}` : '0.5px solid transparent',
          transition: 'border-color 240ms ease',
        }}>
          <button
            onClick={onBack}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 0,
              display: 'flex', alignItems: 'center', gap: 5,
              minHeight: 44,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
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
              letterSpacing: '0.04em',
            }}>
              返回
            </span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button onClick={toggleFavorite} disabled={favoriteBusy} aria-label={favorite ? '取消收藏' : '收藏作品'} style={{ border: 0, background: 'transparent', color: favorite ? theme.accent : theme.inkLight, fontFamily: theme.sans, fontSize: 12, letterSpacing: '0.06em', cursor: 'pointer', minHeight: 44, padding: 0 }}>{favorite ? '已收藏' : '收藏'}</button>
            <WarmToggle theme={theme} on={warm} onToggle={onToggleWarm} />
          </div>
        </div>
      </div>

      <PaperBg theme={theme} scrollRef={scrollRef}>
        <div style={{ height: theme.__inFrame ? 84 : 60 }} />

        <div style={{ padding: '0 24px' }}>
          <div style={{
            fontFamily: theme.serif,
            fontSize: 22,
            fontWeight: theme.weights.readingTitle,
            color: theme.ink,
            lineHeight: 1.35,
            letterSpacing: '0.02em',
          }}>
            {article?.title}
          </div>

          <div style={{
            marginTop: 6,
            fontFamily: theme.sans,
            fontSize: 11,
            fontWeight: theme.weights.body,
            color: theme.inkLight,
            letterSpacing: '0.04em',
          }}>
            文 / {article?.author}
          </div>
        </div>

        {article?.intro ? <VerticalIntro theme={theme} text={article.intro} /> : null}

        <div style={{ padding: '0 24px' }}>
          <ReadingCover
            theme={theme}
            src={article?.cover_image_url}
            alt={article?.title}
          />
          {(article?.cover_photographer || article?.cover_caption) && (
            <div style={{ marginTop: 10 }}>
              {article?.cover_photographer && (
                <div style={{
                  fontFamily: theme.sans,
                  fontSize: 11,
                  fontWeight: theme.weights.body,
                  color: theme.inkLight,
                  letterSpacing: '0.12em',
                }}>
                  摄影 / {article.cover_photographer}
                </div>
              )}
              {article?.cover_caption && (
                <div style={{
                  marginTop: 4,
                  fontFamily: theme.serif,
                  fontSize: 13,
                  fontWeight: theme.weights.body,
                  color: theme.inkSoft,
                  lineHeight: 1.75,
                  letterSpacing: '0.02em',
                  fontStyle: 'italic',
                }}>
                  {article.cover_caption}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Body — full_content only; placeholder if empty */}
        <div style={{ padding: '32px 24px 0' }}>
          {paragraphs.length > 0 ? (
            paragraphs.map((para, i) => (
              <div key={i} style={{
                fontFamily: theme.sans,
                fontSize: 15,
                fontWeight: theme.weights.body,
                color: theme.ink,
                lineHeight: 1.95,
                marginBottom: i < paragraphs.length - 1 ? 18 : 0,
                letterSpacing: '0.02em',
                textWrap: 'pretty',
              }}>
                {para}
              </div>
            ))
          ) : (
            <div style={{
              fontFamily: theme.sans,
              fontSize: 13,
              fontWeight: theme.weights.body,
              color: theme.inkLight,
              lineHeight: 1.8,
              letterSpacing: '0.04em',
            }}>
              作者暂未上传正文。
            </div>
          )}
        </div>

        {requestId ? <FeedbackSection
          theme={theme}
          article={article}
          requestId={requestId}
          userPrefs={userPrefs}
          visible={showFeedback}
        /> : null}

        <BottomInset />
        <div style={{ height: 24 }} />
      </PaperBg>
    </>
  );
}
