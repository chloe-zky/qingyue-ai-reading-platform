// reader/themes.js — C 冷月 design tokens
// Single theme with reader-toggleable 护眼模式 (warm paper).
// Font weights are finalised; adjust here if needed.

export const themeBase = {
  // ── Surfaces ──────────────────────────────────────────────
  // Default paper: pure white (round 5 — user wanted a clean white
  // base; previous warm-cream values all read as 旧/泛黄 on real device).
  bg:    '#FFFFFF',
  bg2:   '#EFEAE0',
  divider: '#E5DFD2',

  // 护眼 warm paper — UNCHANGED.
  warmBg:      '#FBF8F2',
  warmBg2:     '#F2EEE5',
  warmDivider: '#E8E5DE',

  // ── Ink ───────────────────────────────────────────────────
  // inkLight slightly darker than the prototype (#9CA0A8 → #7E828A) so
  // eyebrows / captions stay legible on real iOS Safari, where thin weights
  // render lighter than in the desktop iframe preview.
  ink:      '#15171C',
  inkSoft:  '#4B505A',
  inkLight: '#7E828A',

  // ── Accent — 靛蓝墨 ───────────────────────────────────────
  // Used in exactly 6 positions: eyebrow text, selection square,
  // loading scan line, progress bar fill, feedback underline, placeholder square.
  accent: '#1F2A5C',

  // ── Font stacks ───────────────────────────────────────────
  // Unified PingFang SC — real, weight-responsive on Apple platforms.
  // Add "Noto Serif SC" to your index.html for cross-platform coverage.
  serif: '"PingFang SC", -apple-system, "Helvetica Neue", sans-serif',
  sans:  '"PingFang SC", -apple-system, "Helvetica Neue", sans-serif',
};

// Weights tuned for real iOS Safari rendering of PingFang SC.
// PingFang only ships discrete weights (100/200/300/400/500/600); values like
// 250 snap to Thin (200) and disappear on small text. Anything reader-visible
// is now ≥ 300; eyebrow / body stay light enough to keep the "softpaper" feel.
export const WEIGHT_DEFAULTS = {
  stepTitle:    500,   // selection-page question — heavier this round
  listTitle:    500,   // round 4 bump
  readingTitle: 400,   // round 5 — lighter per user request
  option:       400,   // option labels in step screen
  masthead:     300,   // "轻阅读" heading — round 5 lighter
  intro:        300,   // 扉页推荐语
  body:         300,   // body paragraphs + captions
  eyebrow:      400,   // "NO. 01 · 推荐" labels
};

/**
 * Derive runtime theme from warm mode + optional weight overrides.
 * @param {{ warm?: boolean, weights?: Partial<typeof WEIGHT_DEFAULTS>, inFrame?: boolean }} opts
 */
export function deriveTheme({ warm = false, weights = {}, inFrame = false } = {}) {
  return {
    ...themeBase,
    bg:      warm ? themeBase.warmBg      : themeBase.bg,
    bg2:     warm ? themeBase.warmBg2     : themeBase.bg2,
    divider: warm ? themeBase.warmDivider : themeBase.divider,
    weights: { ...WEIGHT_DEFAULTS, ...weights },
    // Flag used by TopInset to decide safe-area vs frame padding
    __inFrame: inFrame,
  };
}
