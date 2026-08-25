// InternalApp.jsx — 轻阅读 · 内部后台 · 应用外壳（桌面 + 手机两套形态）。
// 桌面布局移植自 prototype-admin/app.jsx，手机布局移植自 prototype-admin/mobile.jsx。
//
// 开发说明 §六：两端共用同一套设计 token 与权限矩阵，组件按平台各自布局；
// 手机端不复制桌面的复杂表格与多列布局，高风险操作用 DeskCue 引导回桌面端。
// 因此这里只共享「会话 / 角色 / Toast / 确认状态」，呈现层完全分开：
//   桌面 .ibx  → Rail 侧栏 + Topbar + 居中 ConfirmDialog
//   手机 .ibx-m → 大标题栏 + 底部 tab bar + 底部抬升 ConfirmSheet
//
// 与原型的共同差异（两端一致）：
// 1. 不含「预览角色」切换器与状态演示按钮 —— §一 明确非生产界面。
// 2. 角色来自 GET /api/internal/me；§四 要求的路由级守卫在两端各做一次。
// 3. 会话过期由 apiClient 的真实 401 广播触发，非演示按钮。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StaffAuthProvider from '../auth/StaffAuthProvider';
import StaffPasswordSetup from '../auth/StaffPasswordSetup';
import ProtectedRoute from '../auth/ProtectedRoute';
import { AUTH_STATUS, useStaffAuth } from '../auth/staffAuth';
import { onUnauthorized } from '../lib/apiClient';
import Icon from './shared/Icon';
import { ROLES, ROLE_FROM_BACKEND, NAV, NAV_LABEL, HOME, VIEW_ROLES } from './shared/constants';
import { RoleBadge, ForbiddenState, NotFoundState } from './shared/ui';
import { ConfirmDialog, SessionExpiredDialog, ToastHost } from './shared/dialogs';
import { useToasts } from './shared/useToasts';
import InternalLogin from './InternalLogin';
import { PlatformOverview, LLMConfig, StaffAccounts, SystemHealth, TechnicalLogs } from './platform';
import { EditorialOverview, PromptManager, TagVocabulary, RecommendationStrategy, StrategySimulator, EditorialAuditLogs } from './editorial';
import { ReviewWorkspace, MyReviewHistory } from './review';
import MobileWorkbench from './mobile/MobileWorkbench';
import MobileLogin from './mobile/MobileLogin';
import { ConfirmSheet } from './mobile/core';
import EditorPage from '../EditorPage';
import './internal.css';
import './mobile.css';

const PAGES = {
  overview: PlatformOverview, llm: LLMConfig, staff: StaffAccounts, health: SystemHealth, logs: TechnicalLogs,
  eoverview: EditorialOverview, prompt: PromptManager, tags: TagVocabulary, reco: RecommendationStrategy, sim: StrategySimulator, editLogs: EditorialAuditLogs,
  review: ReviewWorkspace, myReviews: MyReviewHistory,
};

const ROLE_PATHS = {
  admin: '/studio/platform',
  lead: '/studio/editorial',
  review: '/studio/review',
};

// 与项目既有约定一致（EditorPage 也用 820px）：≤820 视为手机端。
const MOBILE_QUERY = '(max-width: 820px)';
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(MOBILE_QUERY).matches : false
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

/* ── 登录前的四种状态 · 桌面 ── */
function DesktopGate({ status, error, retry, sessionExpiredHint }) {
  if (status === AUTH_STATUS.LOADING) {
    return <div className="state-box" style={{ margin: 'auto' }}><div className="sb-t">正在确认登录状态…</div><div className="sb-d">正在校验凭证并读取账号角色。</div></div>;
  }
  if (status === AUTH_STATUS.UNCONFIGURED) {
    return (
      <div className="state-box" style={{ margin: 'auto' }}>
        <div className="sb-ico" style={{ color: 'var(--warn)' }}><Icon id="warn" size={52} /></div>
        <div className="sb-t">前端未配置 Supabase</div>
        <div className="sb-d">请复制 front/.env.example 为 front/.env.local，填入 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY 后重启开发服务器。前端只能使用 anon public key。</div>
      </div>
    );
  }
  if (status === AUTH_STATUS.FORBIDDEN) {
    return (
      <div className="state-box" style={{ margin: 'auto' }}>
        <div className="sb-ico" style={{ color: 'var(--warn)' }}><Icon id="forbidden" size={52} /></div>
        <div className="sb-t">此账号没有内部工作台权限</div>
        <div className="sb-d">登录本身成功了，但该账号未被分配员工角色，或账号已被停用。请联系平台管理员开通。{error ? `（${error}）` : ''}</div>
      </div>
    );
  }
  if (status === AUTH_STATUS.UNAVAILABLE) {
    return (
      <div className="state-box" style={{ margin: 'auto' }}>
        <div className="sb-ico" style={{ color: 'var(--danger)' }}><Icon id="warn" size={52} /></div>
        <div className="sb-t">暂时无法确认权限</div>
        <div className="sb-d">员工权限服务未响应，可能是后端未启动或数据库暂不可用。稍后重试即可，无需重新登录。{error ? `（${error}）` : ''}</div>
        <button className="btn ghost" onClick={retry}><Icon id="refresh" size={14} className="btn-ico" />重试</button>
      </div>
    );
  }
  return <InternalLogin sessionExpiredHint={sessionExpiredHint} />;
}

/* ── 登录前的四种状态 · 手机（沿用手机端 state-box 尺寸）── */
function MobileGate({ status, error, retry, sessionExpiredHint }) {
  const box = (icon, color, title, desc, action) => (
    <div className="app theme-lit" style={{ justifyContent: 'center' }}>
      <div className="state-box">
        {icon && <div className="sb-ico" style={{ color }}><Icon id={icon} size={46} /></div>}
        <div className="sb-t">{title}</div>
        <div className="sb-d">{desc}</div>
        {action}
      </div>
    </div>
  );
  if (status === AUTH_STATUS.LOADING) return box(null, null, '正在确认登录状态…', '正在校验凭证并读取账号角色。');
  if (status === AUTH_STATUS.UNCONFIGURED) return box('warn', 'var(--warn)', '前端未配置 Supabase', '请填写 front/.env.local 的 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY 后重启开发服务器。');
  if (status === AUTH_STATUS.FORBIDDEN) return box('forbidden', 'var(--warn)', '此账号没有内部工作台权限', `该账号未被分配员工角色，或已被停用。请联系平台管理员开通。${error ? `（${error}）` : ''}`);
  if (status === AUTH_STATUS.UNAVAILABLE) {
    return box('warn', 'var(--danger)', '暂时无法确认权限', `员工权限服务未响应，稍后重试即可，无需重新登录。${error ? `（${error}）` : ''}`,
      <button className="btn ghost sm" style={{ margin: '0 auto' }} onClick={retry}><Icon id="refresh" size={14} className="btn-ico" />重试</button>);
  }
  return <MobileLogin hint={sessionExpiredHint} />;
}

/* ── 桌面工作台 ── */
function DesktopWorkbench({ ctx, view, setView, role, staff, signOut }) {
  const nav = NAV[role] || [];
  const curNav = nav.find((n) => n.k === view);
  const Page = PAGES[view];
  const allowed = VIEW_ROLES[view];
  const permitted = Array.isArray(allowed) && allowed.includes(role);
  const initial = (staff.display_name || staff.email || '?').trim().charAt(0);

  return (
    <div className="app">
      <div className="rail">
        <div className="brand"><div className="bt"><span className="seal">轻</span>轻阅读 Studio</div><div className="bs">Internal Backend</div></div>
        <div className="rolechip"><div className="rc-k">当前角色</div><div className="rc-v"><span className="rd" />{ROLES[role].name}</div></div>
        <div className="navlabel">{NAV_LABEL[role]}</div>
        <div className="navlist">
          {nav.map((n) => (
            <button key={n.k} className={'navitem' + (view === n.k ? ' on' : '')} onClick={() => setView(n.k)}>
              <span className="ni-ico"><Icon id={n.icon} size={18} /></span><span className="ni-t">{n.name}</span>
            </button>
          ))}
        </div>
        <div className="railfoot">
          <div className="userbox"><div className="av">{initial}</div><div className="ub-t"><div className="ub-n">{staff.display_name || '—'}</div><div className="ub-e">{staff.email}</div></div></div>
          <button className="logout" onClick={signOut}><Icon id="logout" size={13} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />退出登录</button>
        </div>
      </div>
      <div className="main">
        <div className="topbar">
          <div className="crumb"><span>轻阅读 内部后台</span><span className="c-sep">›</span><span>{ROLES[role].name}</span><span className="c-sep">›</span><span className="c-now">{permitted ? (curNav?.name ?? '页面不存在') : '无权访问'}</span></div>
          <div className="spacer" />
          <button className="tb-btn bell" onClick={() => ctx.push('暂无新的通知', 'info')}><Icon id="bell" size={16} className="tb-icon" /><span className="dot" /></button>
          <RoleBadge role={role} />
        </div>
        <div className="scroll" key={view}>
          {!permitted ? <ForbiddenState />
            : Page ? <Page ctx={ctx} />
              : <NotFoundState onHome={() => setView(HOME[role])} />}
        </div>
      </div>
    </div>
  );
}

function InternalShell() {
  const { status, staff, signOut, authAction } = useStaffAuth();
  const isMobile = useIsMobile();
  const role = staff ? ROLE_FROM_BACKEND[staff.role] : null;

  // 桌面与手机的当前视图互不相同（view key vs tab key），各存一份，跨断点不串。
  const [view, setView] = useState(null);
  const [tab, setTab] = useState('home');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [expired, setExpired] = useState(false);
  const [expiredHint, setExpiredHint] = useState(false);
  const { toasts, push } = useToasts();
  const [confirmState, setConfirmState] = useState(null);
  const [confirmNote, setConfirmNote] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);

  const wasAuthed = useRef(false);
  useEffect(() => { wasAuthed.current = status === AUTH_STATUS.AUTHENTICATED; }, [status]);
  useEffect(() => onUnauthorized(() => { if (wasAuthed.current) setExpired(true); }), []);
  useEffect(() => {
    if (!role || authAction || status !== AUTH_STATUS.AUTHENTICATED) return;
    const target = ROLE_PATHS[role];
    if (target && window.location.pathname !== target) {
      window.history.replaceState({}, '', target);
    }
  }, [authAction, role, status]);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setConfirmNote('');
    setConfirmState({ opts, resolve });
  }), []);

  async function onConfirmOk() {
    const { opts, resolve } = confirmState;
    if (opts.requireNote && !confirmNote.trim()) return;
    setConfirmBusy(true);
    await new Promise((r) => setTimeout(r, 650));
    setConfirmBusy(false);
    setConfirmState(null);
    resolve({ ok: true, note: confirmNote });
  }
  function onConfirmCancel() { const r = confirmState.resolve; setConfirmState(null); r({ ok: false }); }

  const ctx = useMemo(() => ({
    push,
    confirm,
    go: (v) => (isMobile ? setTab(v) : setView(v)),
    openReview: () => {
      if (role === 'review') setReviewOpen(true);
      else push('当前角色没有稿件审读权限', 'err');
    },
  }), [push, confirm, isMobile, role]);

  const doSignOut = () => {
    setView(null);
    setTab('home');
    setReviewOpen(false);
    window.history.replaceState({}, '', '/studio/login');
    signOut();
  };
  const activeView = view ?? (role ? HOME[role] : null);
  const theme = role === 'lead' ? 'theme-lit' : 'theme-tech';

  // 邀请与找回密码均先走统一设密页；完成后 Provider 会清理回调 URL，
  // 再按后端返回的真实角色进入对应工作台。
  if (authAction) {
    return (
      <div className={(isMobile ? 'ibx-m ' : 'ibx ') + 'theme-lit'}>
        <StaffPasswordSetup mobile={isMobile} />
      </div>
    );
  }

  // 完整审稿页保留在同一个 StaffAuthProvider 内，不再跳转到旧共享 Token 入口。
  // EditorPage 只复用呈现和稿件状态机；所有请求通过统一 apiClient 携带 Bearer。
  if (staff && role === 'review' && reviewOpen) {
    return (
      <EditorPage
        staffSession
        displayName={staff.display_name || staff.email || '审稿编辑'}
        onExit={() => setReviewOpen(false)}
      />
    );
  }

  return (
    <div className={(isMobile ? 'ibx-m ' : 'ibx ') + theme}>
      <ProtectedRoute fallback={(s) => (isMobile
        ? <MobileGate {...s} sessionExpiredHint={expiredHint} />
        : <DesktopGate {...s} sessionExpiredHint={expiredHint} />)}>
        {staff && (isMobile
          ? <MobileWorkbench ctx={ctx} role={role} tab={tab} setTab={setTab} signOut={doSignOut} />
          : <DesktopWorkbench ctx={ctx} view={activeView} setView={setView} role={role} staff={staff} signOut={doSignOut} />)}
      </ProtectedRoute>

      {/* 全局叠层：两端 DOM 结构不同，状态同源 */}
      <ToastHost toasts={toasts} />
      {confirmState && (isMobile
        ? <ConfirmSheet state={confirmState} note={confirmNote} setNote={setConfirmNote} busy={confirmBusy} onOk={onConfirmOk} onCancel={onConfirmCancel} />
        : <ConfirmDialog open {...confirmState.opts} busy={confirmBusy} note={confirmNote}
          onNote={setConfirmNote} onConfirm={onConfirmOk} onCancel={onConfirmCancel} />)}

      {expired && (isMobile
        ? (
          <div className="scrim" style={{ alignItems: 'center' }}>
            <div className="sheet" style={{ borderRadius: 20, width: '86%', margin: '0 auto', paddingBottom: 0 }}>
              <div className="sheet-h" style={{ paddingTop: 20 }}><div className="mi info"><Icon id="clock" size={19} /></div><div><div className="mt">登录状态已过期</div><div className="md">为保障账号安全，登录会话已超时，请重新登录。</div></div></div>
              <div className="sheet-foot" style={{ paddingBottom: 20 }}><button className="btn" onClick={() => { setExpired(false); setExpiredHint(true); doSignOut(); }}>重新登录</button></div>
            </div>
          </div>
        )
        : <SessionExpiredDialog open onRelogin={() => { setExpired(false); setExpiredHint(true); doSignOut(); }} />)}
    </div>
  );
}

/**
 * 内部后台入口。桌面与手机同一入口，按视口自动切换形态。
 */
export default function InternalApp() {
  return (
    <StaffAuthProvider>
      <InternalShell />
    </StaffAuthProvider>
  );
}
