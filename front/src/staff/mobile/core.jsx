// core.jsx — 手机端通用小件。
// DOM / 类名逐字移植自 prototype-admin/mobile-core.jsx。
//
// 与桌面端 shared/ui.jsx 是两套独立组件，不共用：手机端的徽章、状态盒、
// 加载骨架尺寸都比桌面小一档，类名相同但取值不同（见 mobile.css 的作用域说明）。
// 复用的只有 Icon（同一套线描图标）与设计 token。

import Icon from '../shared/Icon';
import { ROLES } from '../shared/constants';

export function MSpin() { return <span className="spin" />; }

export function MBadge({ kind, children }) {
  return <span className={'badge ' + kind}><span className="bd" />{children}</span>;
}

export function MRoleBadge({ role }) {
  const r = ROLES[role];
  return <span className={'rolebadge ' + role}><span className="rb-d" />{r.name}</span>;
}

export function MVer({ v, label }) {
  return <span className="verbadge">{label && <span className="vp">{label}</span>}{v}</span>;
}

/** 桌面端引导条：高风险操作在手机端不做，明确指回桌面端（开发说明 §六）。 */
export function DeskCue({ children }) {
  return <div className="deskcue"><div className="dc-ico"><Icon id="overview" size={15} /></div><div>{children}</div></div>;
}

export function MEmpty({ icon = 'empty', title, desc, action }) {
  return (
    <div className="state-box">
      <div className="sb-ico"><Icon id={icon} size={46} /></div>
      <div className="sb-t">{title}</div>
      {desc && <div className="sb-d">{desc}</div>}
      {action}
    </div>
  );
}

export function MLoading({ rows = 3 }) {
  return (
    <div style={{ padding: '4px 0' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel" style={{ height: 64, marginBottom: 11, opacity: 1 - i * 0.16 }} />
      ))}
    </div>
  );
}

/** 落地补充：原型手机端没有错误态盒（无失败路径），接真实接口后必须有。
 *  沿用 state-box 结构，仅把图标换成 warn 并配重试按钮，与桌面 ErrorState 一致。 */
export function MError({ title = '加载失败', desc = '请检查网络连接后重试。', onRetry }) {
  return (
    <div className="state-box">
      <div className="sb-ico" style={{ color: 'var(--danger)' }}><Icon id="warn" size={46} /></div>
      <div className="sb-t">{title}</div>
      <div className="sb-d">{desc}</div>
      {onRetry && <button className="btn ghost sm" style={{ margin: '0 auto' }} onClick={onRetry}><Icon id="refresh" size={14} className="btn-ico" />重试</button>}
    </div>
  );
}

export function MNav({ title, eyebrow, large, onBack, right }) {
  return (
    <div className={'mnav' + (large ? '' : ' compact')}>
      <div className="row">
        {onBack ? <button className="back" onClick={onBack}><span className="chev">‹</span>{onBack.label || '返回'}</button> : <span style={{ width: 30 }} />}
        {!large && <span className="center">{title}</span>}
        <div className="tb-r">{right}</div>
      </div>
      {large && <div className="large"><span className="eb">{eyebrow}</span>{large}</div>}
    </div>
  );
}

/** 底部抬升确认 sheet —— 手机端用它替代桌面的居中 ConfirmDialog（开发说明 §六）。 */
export function ConfirmSheet({ state, note, setNote, busy, onOk, onCancel }) {
  if (!state) return null;
  const o = state.opts;
  return (
    <div className="scrim" onClick={() => !busy && onCancel()}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="sheet-h">
          <div className={'mi ' + (o.tone || 'warn')}><Icon id={o.tone === 'info' ? 'check' : 'warn'} size={19} /></div>
          <div><div className="mt">{o.title}</div>{o.desc && <div className="md">{o.desc}</div>}</div>
        </div>
        <div className="sheet-body">
          {o.impact && <div className="impact"><div className="il">此操作将会</div>{o.impact}</div>}
          {o.requireNote && (
            <div className="fld" style={{ marginTop: 14 }}>
              <label className="lbl">变更说明<span className="req">必填</span></label>
              <textarea className="inp" rows={2} placeholder="简要说明本次变更原因，便于审计追溯" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
        </div>
        <div className="sheet-foot">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>取消</button>
          <button className={'btn ' + (o.tone === 'danger' ? 'danger' : '')} onClick={onOk} disabled={busy || (o.requireNote && !note.trim())}>
            {busy ? <><MSpin />处理中…</> : (o.confirmText || '确认')}
          </button>
        </div>
      </div>
    </div>
  );
}
