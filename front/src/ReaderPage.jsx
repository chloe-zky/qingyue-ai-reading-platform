// front/src/ReaderPage.jsx
// Drop-in replacement for the existing ReaderPage.
// Importable as: import ReaderPage from "./ReaderPage";

import { useState, useMemo, useCallback, useEffect } from 'react';
import './ReaderPage.css';
import { deriveTheme, WEIGHT_DEFAULTS } from './reader/themes.js';
import { IOSDevice }      from './reader/IOSDevice.jsx';
import { StepScreen }     from './reader/StepScreen.jsx';
import { LoadingScreen }  from './reader/LoadingScreen.jsx';
import { ListScreen }     from './reader/ListScreen.jsx';
import { ReadingScreen }  from './reader/ReadingScreen.jsx';
import { apiFetch } from './lib/apiClient.js';

const WARM_KEY  = 'reader.warmMode.v1';

const STEPS = [
  {
    eyebrow:  'STEP 01 · 卷一',
    question: '故事，发生在哪里？',
    key:      'setting_tags',
    options: [
      { label: '现代', desc: '都市霓虹与地铁口的告别' },
      { label: '古风', desc: '檐角铜铃落雪的旧朝' },
      { label: '民国', desc: '蓝布长衫与黄包车的春天' },
    ],
  },
  {
    eyebrow:  'STEP 02 · 卷二',
    question: '想读哪种故事味道？',
    key:      'story_tone_tags',
    options: [
      { label: '清甜校园', desc: '操场尽头的傍晚六点' },
      { label: '遗憾青春', desc: '没有说出口的那句话' },
      { label: '温暖治愈', desc: '冬日午后第二杯茶' },
      { label: '浓情曲折', desc: '一封写了又烧掉的信' },
    ],
  },
  {
    eyebrow:  'STEP 03 · 卷三',
    question: '最想看哪种关系？',
    key:      'relationship_core_tags',
    options: [
      { label: '暗恋未明', desc: '只敢在他身后看他的侧脸' },
      { label: '久别重逢', desc: '巷口杏花开了第三回' },
      { label: '相伴成长', desc: '从同桌到同桌之外' },
      { label: '命运拉扯', desc: '错过的人，又一次走近' },
    ],
  },
];

function useIsDesktop() {
  const [ok, setOk] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 769px)').matches
  );
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 769px)');
    const fn  = (e) => setOk(e.matches);
    mql.addEventListener('change', fn);
    return () => mql.removeEventListener('change', fn);
  }, []);
  return ok;
}

function ScreenTransition({ keyName, children }) {
  const [k,     setK]     = useState(keyName);
  const [stage, setStage] = useState('in');

  useEffect(() => {
    if (k === keyName) return;
    const outTimer = setTimeout(() => setStage('out'), 0);
    const inTimer = setTimeout(() => { setK(keyName); setStage('in'); }, 140);
    return () => {
      clearTimeout(outTimer);
      clearTimeout(inTimer);
    };
  }, [keyName, k]);

  return (
    <div style={{
      position: 'absolute', inset: 0,
      opacity:   stage === 'in' ? 1 : 0,
      transform: stage === 'in' ? 'translateY(0)' : 'translateY(4px)',
      transition: 'opacity 220ms ease, transform 220ms ease',
    }}>
      {children}
    </div>
  );
}

export default function ReaderPage() {
  const isDesktop = useIsDesktop();

  const [warm, setWarm] = useState(() => {
    try { return localStorage.getItem(WARM_KEY) === '1'; } catch { return false; }
  });
  const toggleWarm = useCallback(() => {
    setWarm((w) => {
      const next = !w;
      try { localStorage.setItem(WARM_KEY, next ? '1' : '0'); } catch { /* storage may be unavailable */ }
      return next;
    });
  }, []);

  const [weights] = useState(WEIGHT_DEFAULTS);

  const theme = useMemo(
    () => deriveTheme({ warm, weights, inFrame: isDesktop }),
    [warm, weights, isDesktop]
  );

  const [phase,    setPhase]    = useState('step');
  const [stepIdx,  setStepIdx]  = useState(0);

  const [selections, setSelections] = useState({
    setting_tags:           [],
    story_tone_tags:        [],
    relationship_core_tags: [],
  });

  const [articles,   setArticles]   = useState([]);
  const [requestId,  setRequestId]  = useState('');
  const [apiError,   setApiError]   = useState(null);
  const [listPage,   setListPage]   = useState(0);
  const [currentArticle, setCurrentArticle] = useState(null);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleToggle = (key, label) => {
    setSelections((prev) => {
      const cur  = prev[key] || [];
      const next = cur.includes(label)
        ? cur.filter((x) => x !== label)
        : [...cur, label];
      return { ...prev, [key]: next };
    });
  };

  // Shared fetch — called by handleNext (last step) and handleSkip (skip all).
  const fetchRecommendations = async () => {
    setPhase('loading');
    const t0 = Date.now();
    try {
      const data = await apiFetch('/api/recommendations', {
        method:  'POST',
        auth: 'optional-reader',
        body: selections,
      });
      setRequestId(data.request_id  || '');
      setArticles(data.results      || []);
      setApiError(null);
    } catch (err) {
      setApiError(err.message || '网络错误');
      setArticles([]);
    }
    const elapsed   = Date.now() - t0;
    const remaining = Math.max(0, 1400 - elapsed);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    setListPage(0);
    setPhase('list');
  };

  const handleNext = async () => {
    if (stepIdx < STEPS.length - 1) {
      setStepIdx(stepIdx + 1);
      return;
    }
    await fetchRecommendations();
  };

  // Skip = jump past ALL remaining steps and go straight to recommendations,
  // using whatever's currently selected (possibly empty).
  const handleSkip = () => { fetchRecommendations(); };

  const handleStepBack = () => {
    setStepIdx((i) => Math.max(0, i - 1));
  };

  const handleOpenArticle = (article) => {
    setCurrentArticle(article);
    setPhase('reading');
  };

  // Reading → list (existing flow).
  const handleBack = () => { setPhase('list'); };

  // List → step 0 (round 4 — replaces the removed ↺ reset button).
  // Keeps existing selections so the user can tweak and re-submit.
  const handleBackToSteps = () => {
    setPhase('step');
    setStepIdx(0);
  };

  // ── Screen routing ───────────────────────────────────────────────────────

  let screen, screenKey;
  const step = STEPS[stepIdx];

  switch (phase) {
    case 'step':
      screenKey = `step-${stepIdx}`;
      screen = (
        <StepScreen
          theme={theme}
          steps={STEPS}
          stepIndex={stepIdx}
          selected={selections[step.key] || []}
          onToggle={(label) => handleToggle(step.key, label)}
          onNext={handleNext}
          onSkip={handleSkip}
          onBack={handleStepBack}
        />
      );
      break;

    case 'loading':
      screenKey = 'loading';
      screen = <LoadingScreen theme={theme} />;
      break;

    case 'list':
      screenKey = `list-${listPage}`;
      screen = (
        <ListScreen
          theme={theme}
          articles={articles}
          error={apiError}
          page={listPage}
          onPage={setListPage}
          onOpen={handleOpenArticle}
          onBack={handleBackToSteps}
        />
      );
      break;

    case 'reading':
      screenKey = `reading-${currentArticle?.book_id}`;
      screen = (
        <ReadingScreen
          theme={theme}
          article={currentArticle}
          requestId={requestId}
          userPrefs={selections}
          onBack={handleBack}
          warm={warm}
          onToggleWarm={toggleWarm}
        />
      );
      break;
  }

  // ── App content ─────────────────────────────────────────────────────────
  // Round 4: removed top-right ↺ reset button (was overlapping with
  // 护眼). Replaced by the in-screen 返回 button on ListScreen.
  const appContent = (
    <div
      className="reader-app-root"
      style={{ background: theme.bg, transition: 'background 320ms ease' }}
    >
      <ScreenTransition keyName={screenKey}>
        {screen}
      </ScreenTransition>
    </div>
  );

  if (isDesktop) {
    return (
      <div className="reader-preview-wrapper">
        <div className="reader-preview-header">
          <div className="reader-preview-eyebrow">— READER PAGE · 读者端 · C 冷月 —</div>
          <div className="reader-preview-title">轻阅读 · 单一视觉方案</div>
          <div className="reader-preview-desc">
            护眼模式入口仅在正文页顶部右侧。
          </div>
        </div>

        <IOSDevice width={390} height={844}>
          {appContent}
        </IOSDevice>

        <div className="reader-preview-footer">
          桌面端预览 — 手机访问将全屏展示
        </div>
      </div>
    );
  }

  return (
    <div className="reader-mobile-wrapper">
      {appContent}
    </div>
  );
}
