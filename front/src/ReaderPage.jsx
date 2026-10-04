// front/src/ReaderPage.jsx
// Drop-in replacement for the existing ReaderPage.
// Importable as: import ReaderPage from "./ReaderPage";

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import './ReaderPage.css';
import { deriveTheme, WEIGHT_DEFAULTS } from './reader/themes.js';
import { IOSDevice }      from './reader/IOSDevice.jsx';
import { StepScreen }     from './reader/StepScreen.jsx';
import { LoadingScreen }  from './reader/LoadingScreen.jsx';
import { ListScreen }     from './reader/ListScreen.jsx';
import { ReadingScreen }  from './reader/ReadingScreen.jsx';
import { RetryScreen }    from './reader/RetryScreen.jsx';
import { SearchBar, SearchNotice } from './reader/SearchBar.jsx';
import { useReaderAuth } from './reader/ReaderAuthContext.js';
import { getRecommendations, peekRecommendations } from './lib/recommendationCache.js';
import { hydrateArticle, searchBooks } from './lib/bookApi.js';
import {
  DEBOUNCE_MS, errorSearch, idleSearch, isCurrent, isSearchActive,
  isSearchable, loadingSearch, normalizeQuery, resultsSearch,
} from './lib/searchState.js';
import { getPublishedVocabulary } from './lib/tagApi.js';
import {
  getDailyPreference,
  peekDailyPreference,
  saveDailyPreference,
} from './lib/dailyPreferenceApi.js';
import {
  emptySelections,
  forgetLegacyDiscoveryState,
  viewFromDailyState,
  viewFromError,
} from './lib/dailyDiscoveryState.js';

// 接口很快返回时，loading 一闪而过反而像闪屏。给用户主动提交的那一次一个很短的
// 下限；恢复会话与命中缓存的路径不等待，立即出结果。
const ANTI_FLICKER_MS = 220;

const WARM_KEY  = 'reader.warmMode.v1';

const FALLBACK_STEPS = [
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

const STEP_META = Object.fromEntries(FALLBACK_STEPS.map((step) => [step.key, step]));
const OPTION_DESCRIPTIONS = Object.fromEntries(
  FALLBACK_STEPS.flatMap((step) => step.options.map((option) => [option.label, option.desc])),
);

function stepsFromVocabulary(vocabulary) {
  return FALLBACK_STEPS.map((fallback) => {
    const labels = vocabulary?.[fallback.key];
    if (!Array.isArray(labels) || labels.length === 0) return fallback;
    const meta = STEP_META[fallback.key];
    return {
      ...meta,
      options: labels.map((label) => ({
        label,
        desc: OPTION_DESCRIPTIONS[label] || '从已发布标签词表中选择',
      })),
    };
  });
}

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

function ScreenTransition({ keyName, animate = true, children }) {
  return (
    <div
      key={keyName}
      className={animate ? 'reader-page-breathe' : undefined}
      style={{ position: 'absolute', inset: 0 }}
    >
      {children}
    </div>
  );
}

// active：本页在 UserApp 里是常驻挂载、靠 visibility 切显隐的（见 UserApp
// 的注释），所以「用户看没看到」得由外面告诉它——搜索栏的首次亮相要等到真的
// 被看见才开始，否则用户还在首页时它就自己演完了。
export default function ReaderPage({ active = true, onReadingChange }) {
  const { session } = useReaderAuth();
  const userId = session?.user?.id || '';
  const isDesktop = useIsDesktop();
  // 登录读者的「今天选过没有」由服务端按北京时间业务日决定（见 dailyPreferenceApi）。
  // 匿名访问没有服务端每日状态，保持原来的单次会话行为：每次进来重新选。
  const [initialView] = useState(() => {
    const cached = userId ? peekDailyPreference(userId) : null;
    return cached ? viewFromDailyState(cached) : null;
  });
  const dailyLoadedOnce = useRef('');
  // 请求序号 + 挂载标记：只让最后一次请求的结果落地（见 fetchRecommendations）。
  const fetchSeq = useRef(0);
  const mountedRef = useRef(true);
  // effect body 必须把标记设回 true，不能只写 cleanup。
  // React 18 StrictMode 在开发模式下会「挂载 → 模拟卸载 → 再挂载」：
  // 只写 cleanup 的话，模拟卸载会把标记置 false，再挂载时没有任何地方复位，
  // 于是 fetchRecommendations 里的 `!mountedRef.current` 永远成立，
  // setPhase('list') 永不执行 —— 发现页会永久停在 loading。
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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
  const [steps, setSteps] = useState(FALLBACK_STEPS);

  useEffect(() => {
    let active = true;
    getPublishedVocabulary()
      .then((vocabulary) => { if (active) setSteps(stepsFromVocabulary(vocabulary)); })
      .catch(() => { /* 保留内置兜底，词表故障不阻断发现页。 */ });
    return () => { active = false; };
  }, []);

  const theme = useMemo(
    () => deriveTheme({ warm, weights, inFrame: isDesktop }),
    [warm, weights, isDesktop]
  );

  // 三种初值，互不重叠：
  //   有热缓存的今日状态 → 直接进对应画面（多数是 list，不闪选择页）
  //   登录但没缓存       → loading，等 GET /daily 给结论
  //   匿名               → 直接进三步选择
  const [phase,    setPhase]    = useState(
    initialView ? initialView.phase : (userId ? 'loading' : 'step'),
  );
  const [stepIdx,  setStepIdx]  = useState(0);

  const [selections, setSelections] = useState(
    () => initialView?.selections || emptySelections(),
  );

  const [articles,   setArticles]   = useState(initialView?.articles || []);
  const [requestId,  setRequestId]  = useState(initialView?.requestId || '');
  const [notice,     setNotice]     = useState(initialView?.notice || '');
  const [apiError,   setApiError]   = useState(null);
  const [loadError,  setLoadError]  = useState('');
  // 错误页的重试要回到出错的那一步：读取今日状态，还是保存这次选择。
  const [retryMode,  setRetryMode]  = useState('load');
  const [listPage,   setListPage]   = useState(0);
  const [currentArticle, setCurrentArticle] = useState(null);

  // ── 搜索 ────────────────────────────────────────────────────────────────
  // 搜索是一层覆盖，不改动 phase / listPage / selections：清空搜索就自然回到
  // 原来的偏好页或推荐页与页码，也不会重新触发或覆盖「今日偏好」。
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState(idleSearch);
  // 搜索结果自己的页码。列表每辑 3 篇，7 条结果就是 3 辑——之前这里写死了 0
  // 且 onPage 是空函数，「下一辑」看着能点其实什么都不做，后 4 篇根本翻不到。
  const [searchPage, setSearchPage] = useState(0);
  const searchSeq = useRef(0);

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

  // ── 匿名路径 ──────────────────────────────────────────────────────────
  // 没有服务端每日状态，沿用 60s 内存缓存 + 单次会话行为。
  //   命中缓存     → 完全不进 loading，直接出列表
  //   用户主动提交 → 仅在接口快于 ANTI_FLICKER_MS 时补足差额，防止闪屏
  const fetchRecommendations = useCallback(async (preferences) => {
    const seq = ++fetchSeq.current;

    const cached = peekRecommendations({ audience: null, prefs: preferences });
    if (cached) {
      setRequestId(cached.requestId);
      setArticles(cached.results);
      setNotice(cached.notice || '');
      setApiError(null);
      setListPage(0);
      setPhase('list');
      return;
    }

    setPhase('loading');
    const t0 = Date.now();
    let payload = null;
    let message = '';
    try {
      payload = await getRecommendations({ audience: null, prefs: preferences });
    } catch (err) {
      message = err?.detail || err?.message || '网络错误';
    }

    const remaining = ANTI_FLICKER_MS - (Date.now() - t0);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));

    // 期间用户又提交了一次，或组件已卸载 —— 丢弃这次结果，
    // 否则先发的慢请求会在后发的快请求之后落地，覆盖掉更新的状态。
    if (!mountedRef.current || seq !== fetchSeq.current) return;

    if (payload) {
      setRequestId(payload.requestId);
      setArticles(payload.results);
      setNotice(payload.notice || '');
      setApiError(null);
    } else {
      setApiError(message);
      setArticles([]);
      setNotice('');
    }
    setListPage(0);
    setPhase('list');
  }, []);

  // ── 登录读者路径：服务端每日状态 ──────────────────────────────────────
  const applyDailyState = useCallback((payload) => {
    const view = viewFromDailyState(payload);
    setSelections(view.selections);
    setArticles(view.articles);
    setRequestId(view.requestId);
    setNotice(view.notice);
    setApiError(null);
    setLoadError('');
    setListPage(0);
    setStepIdx(0);
    setPhase(view.phase);
    // 服务端已经给出结论，本地那份无日期的旧状态永远不会再被读，删掉它。
    forgetLegacyDiscoveryState(userId);
  }, [userId]);

  // 只在 await 之后落状态：挂载 effect 直接调用它，初值已经是 loading，
  // 不需要（也不应该）在 effect body 里同步 setState。
  const loadDailyState = useCallback(async () => {
    const seq = ++fetchSeq.current;
    try {
      const payload = await getDailyPreference(userId);
      if (!mountedRef.current || seq !== fetchSeq.current) return;
      applyDailyState(payload);
    } catch (error) {
      if (!mountedRef.current || seq !== fetchSeq.current) return;
      // 请求失败 ≠ 新的一天：停在可重试错误页，绝不落到三步选择，
      // 否则用户重选一遍就把当天已保存的选择覆盖了。
      setRetryMode('load');
      setLoadError(viewFromError(error).message);
      setPhase('error');
    }
  }, [applyDailyState, userId]);

  const submitDailySelections = useCallback(async (next) => {
    setRetryMode('save');
    setPhase('loading');
    const seq = ++fetchSeq.current;
    const t0 = Date.now();
    try {
      // 保存与推荐是同一次往返，不做「先存再查」的串行。
      const payload = await saveDailyPreference(userId, next);
      const remaining = ANTI_FLICKER_MS - (Date.now() - t0);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      if (!mountedRef.current || seq !== fetchSeq.current) return;
      applyDailyState(payload);
    } catch (error) {
      if (!mountedRef.current || seq !== fetchSeq.current) return;
      setLoadError(viewFromError(error).message);
      setPhase('error');
    }
  }, [applyDailyState, userId]);

  useEffect(() => {
    if (!userId || dailyLoadedOnce.current === userId) return;
    dailyLoadedOnce.current = userId;
    if (initialView) {
      // 热缓存已经作为初值渲染，不再多打一次接口、也不再闪一次 loading。
      forgetLegacyDiscoveryState(userId);
      return;
    }
    // 状态只在网络往返之后落地（初值已是 loading），effect body 本身不 setState。
    (async () => { await loadDailyState(); })();
  }, [userId, initialView, loadDailyState]);

  const commitSelections = (next) => (
    userId ? submitDailySelections(next) : fetchRecommendations(next)
  );

  const handleNext = async () => {
    if (stepIdx < steps.length - 1) {
      setStepIdx(stepIdx + 1);
      return;
    }
    await commitSelections(selections);
  };

  // Skip = jump past ALL remaining steps and go straight to recommendations,
  // using whatever's currently selected (possibly empty).
  const handleSkip = () => {
    commitSelections(selections);
  };

  const runSearch = useCallback(async (keyword) => {
    // 序号即「最后一次输入」的凭证：慢响应回来时序号已落后，直接丢弃，
    // 否则用户已经改了词，屏幕上却会闪回上一个词的结果。
    const seq = ++searchSeq.current;
    setSearch(loadingSearch(keyword));
    try {
      const results = await searchBooks(keyword);
      if (!mountedRef.current || !isCurrent(seq, searchSeq.current)) return;
      setSearchPage(0);   // 换了关键词就回到第一辑
      setSearch(resultsSearch(keyword, results));
    } catch (error) {
      if (!mountedRef.current || !isCurrent(seq, searchSeq.current)) return;
      setSearch(errorSearch(keyword, error));
    }
  }, []);

  const clearSearch = useCallback(() => {
    searchSeq.current += 1;    // 作废在途请求，避免它回来又把界面拉回搜索态
    setSearchInput('');
    setSearchPage(0);
    setSearch(idleSearch());
  }, []);

  const handleSearchInput = (value) => {
    setSearchInput(value);
    // 清空/只剩空白或通配符：立刻回到发现页，且不发任何请求。
    if (!isSearchable(value)) {
      searchSeq.current += 1;
      setSearch(idleSearch());
    }
  };

  useEffect(() => {
    if (!isSearchable(searchInput)) return undefined;
    const timer = setTimeout(
      () => { runSearch(normalizeQuery(searchInput)); },
      DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [searchInput, runSearch]);

  // ── 搜索栏几何 ──────────────────────────────────────────────────────────
  // 手机上不额外让安全区：外层 .reader-mobile-wrapper 已经加过一次
  // env(safe-area-inset-top)，再让一次会让搜索栏整条下移约 47px（真机实测）。
  // 桌面预览的设备框自绘状态栏，才需要让开它那 56px（与 TopInset 同值）。
  //
  // 手机上还让搜索栏浮在内容之上、屏幕本身不下移。这不是取巧：外层 wrapper 已经
  // 吃掉一次安全区，每屏的 TopInset 又加了一次，刘海机顶部本就有约 94px 空白，
  // 44px 的搜索栏正好落在这段冗余里，一行正文都不会被盖住。收折/展开于是只是一个
  // transform，滚动中不产生任何重排。桌面预览没有这段冗余，仍旧下移屏幕。
  const SEARCH_BAR_HEIGHT = 44;
  const SEARCH_BAR_TOP = isDesktop ? 56 : 0;
  const overlayBar = !isDesktop;
  const screensTop = overlayBar ? 0 : SEARCH_BAR_TOP + SEARCH_BAR_HEIGHT;

  // ── 搜索栏的出现与收折 ──────────────────────────────────────────────────
  // 默认收起。让它出现的有三处：① 刚到推荐页的那一次亮相；② 用户把内容拉回
  // 最顶部；③ 点顶端那条窄触发区。三处都只管 setBarHidden(false)，什么时候收
  // 统一由下面那只时钟决定——各记各的计时器必然打架：亮相的计时器到点时并不
  // 知道这条栏是用户刚刚自己拉出来的，照收不误。
  //
  // 收折有两条路：展开满 VISIBLE_MS 自动收起（每次展开都算，不只第一次），
  // 或者向下滚动时让路。
  //
  // HIDE_FLOOR 是给回弹留的：iOS 在顶部继续下拉会把 scrollTop 拉成负值，松手弹
  // 回 0 的那一下是个几十像素的正向位移，按位移判定就是「向下滚动」，于是刚拉
  // 出来的栏当场又被收回去——下拉和收折正是在这里打架。顶部这一段不参与收折，
  // 冲突就没有了；反正在顶部也没有内容需要让路。
  //
  // 滚动发生在每屏内部那个 overflow-y:auto 的容器里，scroll 事件不冒泡，所以
  // 用捕获阶段的原生监听在根节点上统一收口，避免逐屏改造。
  const VISIBLE_MS = 4000;     // 展开后无人理会就收起
  const REVEAL_TOP = 4;        // 判定「已经到顶」的余量（含回弹的负值）
  const HIDE_FLOOR = 24;       // 低于这个滚动位置不做收折，把回弹让开
  const DRAG_FRESH_MS = 1200;  // 手指/滚轮多久之内动过，才算这一下是人在拉
  const REVEAL_STEP = 120;     // 单次位移超过这个数就是「瞬移」，不是拉动
  const rootRef = useRef(null);
  const [barHidden, setBarHidden] = useState(true);
  const [searchFocused, setSearchFocused] = useState(false);
  const scrollNode = useRef(null);
  const lastScrollTop = useRef(0);
  const lastDragAt = useRef(0);
  const introDone = useRef(false);

  // 用户正在用这条栏：光标在里面、或者框里还有词、或者搜索结果正占着画面。
  // 这三种情况下时钟停走——栏一收，清除搜索的入口就跟着没了。
  const searchInUse = searchFocused || searchInput !== '' || isSearchActive(search);

  // 第一次进推荐页第一辑时亮相一次。整个挂载周期只此一次：从正文返回、换辑、
  // 恢复到第二辑之后的位置，都不再触发。
  useEffect(() => {
    if (!active || !overlayBar || phase !== 'list' || listPage !== 0) return;
    if (introDone.current) return;
    introDone.current = true;
    setBarHidden(false);
  }, [active, overlayBar, phase, listPage]);

  // 收折时钟：只要栏是展开的就在走，收起或被占用时停。展开的三个来源因此共用
  // 同一套收折规则，第二次、第三次下拉唤出的也一样会自己收回去。
  useEffect(() => {
    if (!overlayBar || barHidden || searchInUse) return undefined;
    const timer = setTimeout(() => setBarHidden(true), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [overlayBar, barHidden, searchInUse, VISIBLE_MS]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !overlayBar) return undefined;

    // 只记真正的拖动（touchmove / 滚轮），不记 touchstart：点「下一辑」也是一次
    // touchstart，记进来就等于给紧随其后的程序化滚动发了通行证。
    const markDrag = () => { lastDragAt.current = Date.now(); };

    const handleScroll = (event) => {
      const node = event.target;
      if (!node || typeof node.scrollTop !== 'number') return;
      const top = node.scrollTop;
      // 换了屏就重新起算，否则上一屏的位置会被当成本屏的位移。
      if (scrollNode.current !== node) {
        scrollNode.current = node;
        lastScrollTop.current = top;
        return;
      }
      const delta = top - lastScrollTop.current;
      lastScrollTop.current = top;
      if (top > HIDE_FLOOR && delta > 6) { setBarHidden(true); return; }

      // 唤出要四个条件同时成立：正在往回拉、已经到顶、这一下是人拉出来的、
      // 而且是拉而不是瞬移。后两条是为了挡掉两种「假下拉」——它们都会产生一个
      // 落到 scrollTop 0 的滚动事件，和用户下拉到顶在事件层面长得一模一样：
      //   · 换辑：ListScreen 在 page 变化后把滚动容器 scrollTop 置 0，而换辑
      //     并不换 DOM 节点（见 ListScreen 里的注释），所以连「换屏重新起算」
      //     那一条都拦不住它；
      //   · 翻页/读取时的加载屏：内容一下子变短，浏览器把超出的 scrollTop
      //     夹回 0，同样冒出一个大幅度的负位移。
      // 两者的位移都是几百像素的一步到位，且此前没有人在拖动。
      const dragged = Date.now() - lastDragAt.current <= DRAG_FRESH_MS;
      const pulled  = delta < 0 && delta > -REVEAL_STEP;
      if (pulled && top <= REVEAL_TOP && dragged) setBarHidden(false);
    };

    root.addEventListener('scroll', handleScroll, true);
    root.addEventListener('touchmove', markDrag, { capture: true, passive: true });
    root.addEventListener('wheel', markDrag, { capture: true, passive: true });
    return () => {
      root.removeEventListener('scroll', handleScroll, true);
      root.removeEventListener('touchmove', markDrag, true);
      root.removeEventListener('wheel', markDrag, true);
    };
  }, [overlayBar]);

  const handleRetry = () => {
    if (retryMode === 'save') {
      submitDailySelections(selections);
      return;
    }
    setPhase('loading');
    loadDailyState();
  };

  const handleStepBack = () => {
    setStepIdx((i) => Math.max(0, i - 1));
  };

  const handleOpenArticle = async (article) => {
    setApiError(null);
    setPhase('loading');
    try {
      setCurrentArticle(await hydrateArticle(article));
      setPhase('reading');
    } catch (error) {
      setApiError(error?.detail || error?.message || '正文读取失败，请稍后再试');
      setPhase('list');
    }
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
  const step = steps[stepIdx] || steps[0];

  switch (phase) {
    case 'step':
      screenKey = `step-${stepIdx}`;
      screen = (
        <StepScreen
          theme={theme}
          steps={steps}
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
          notice={notice}
          page={listPage}
          onPage={setListPage}
          onOpen={handleOpenArticle}
          onBack={handleBackToSteps}
          backLabel={userId ? '重选今日偏好' : '重新选择'}
        />
      );
      break;

    case 'error':
      screenKey = 'error';
      screen = (
        <RetryScreen
          theme={theme}
          title={retryMode === 'save' ? '今日偏好没有保存成功' : '暂时读不到今日推荐'}
          message={loadError}
          onRetry={handleRetry}
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

  // 正文阅读时搜索栏让位，保持沉浸；其余阶段常驻页面最上端。
  const readingNow = phase === 'reading';
  useEffect(() => {
    onReadingChange?.(readingNow);
  }, [onReadingChange, readingNow]);
  const searchOverlay = isSearchActive(search) && !readingNow;
  // 选标签是一段引导流程，顶部只该有这一件事，搜索栏在这几屏里整条退场；
  // 搜索覆盖层接管画面时例外——清除搜索的入口不能跟着一起消失。
  const barGone = readingNow || (phase === 'step' && !searchOverlay);

  if (searchOverlay) {
    // 页码进 key：翻辑时和推荐列表一样有一次淡入淡出，
    // 也让 ListScreen 里那个「换辑回到页首」的副作用照常触发。
    screenKey = `search-${search.phase}-${search.query}-${searchPage}`;
    if (search.phase === 'loading') {
      screen = <LoadingScreen theme={theme} />;
    } else if (search.phase === 'results') {
      screen = (
        <ListScreen
          theme={theme}
          articles={search.results}
          error={null}
          notice={`「${search.query}」· 共 ${search.results.length} 篇`}
          page={searchPage}
          onPage={setSearchPage}
          onOpen={handleOpenArticle}
          onBack={clearSearch}
          backLabel="清除搜索"
        />
      );
    } else {
      screen = (
        <SearchNotice
          theme={theme}
          title={search.phase === 'empty' ? '没有找到这部作品' : '搜索没有完成'}
          message={search.message}
          onClear={clearSearch}
        />
      );
    }
  }

  // ── App content ─────────────────────────────────────────────────────────
  // Round 4: removed top-right ↺ reset button (was overlapping with
  // 护眼). Replaced by the in-screen 返回 button on ListScreen.
  //
  // 搜索栏绝对定位在最上端，安全区由外层 .reader-mobile-wrapper 统一负责；
  // 下面的屏幕整体下移一个搜索栏的高度，各屏自己的 TopInset 正好落在搜索栏
  // 底下的空白里，所以不会出现两层顶部留白。
  // 搜索进行中一律保持展开：不然清除搜索的入口会跟着收折一起消失。
  // 收折只在手机的浮层模式下生效：桌面预览里搜索栏占的是布局高度（screensTop
  // 已经为它让开），收起来只会在顶部留一块空洞，而且那边没有滚动监听可以唤回。
  const barCollapsed = overlayBar && barHidden && !searchOverlay;

  const appContent = (
    <div
      ref={rootRef}
      className="reader-app-root"
      style={{ background: theme.bg, transition: 'background 320ms ease' }}
    >
      {!barGone && (
        <SearchBar
          theme={theme}
          value={searchInput}
          onChange={handleSearchInput}
          onClear={clearSearch}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          active={searchOverlay}
          top={SEARCH_BAR_TOP}
          height={SEARCH_BAR_HEIGHT}
          hidden={barCollapsed}
        />
      )}
      {/* 收起后的唤出条：顶端一条窄触发区，点一下把搜索栏放回来。 */}
      {!barGone && barCollapsed && (
        <button
          type="button"
          onClick={() => setBarHidden(false)}
          aria-label="显示搜索栏"
          style={{
            position: 'absolute',
            top: SEARCH_BAR_TOP, left: 0, right: 0, height: 26,
            zIndex: 4,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        />
      )}
      <div style={{
        position: 'absolute',
        inset: `${barGone ? 0 : screensTop}px 0 0 0`,
      }}>
        <ScreenTransition keyName={screenKey} animate={!readingNow}>
          {screen}
        </ScreenTransition>
      </div>
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
