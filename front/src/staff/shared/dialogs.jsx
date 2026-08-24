// dialogs.jsx — 高风险确认 / 未保存修改 / 会话过期 / Toast 容器。
// DOM 与类名逐字移植自 prototype-admin/shared.jsx。
//
// 开发说明 §五：发布、回滚、禁用账号、修改角色等高风险操作一律走 ConfirmDialog
// 并填写变更说明，不能只用 Toast —— requireNote 为真时确认按钮保持 disabled。

import Icon from './Icon';
import { Spin } from './ui';

export function ConfirmDialog({
  open, tone = 'warn', title, desc, impact,
  confirmText = '确认', cancelText = '取消',
  busy, requireNote, note, onNote, onConfirm, onCancel,
}) {
  if (!open) return null;
  return (
    <div className="scrim" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div className={'mi ' + tone}><Icon id={tone === 'danger' ? 'warn' : (tone === 'info' ? 'check' : 'warn')} size={19} /></div>
          <div><div className="mt">{title}</div>{desc && <div className="md">{desc}</div>}</div>
        </div>
        <div className="modal-body">
          {impact && <div className="impact"><div className="il">此操作将会</div>{impact}</div>}
          {requireNote && (
            <div className="fld" style={{ marginTop: 14 }}>
              <label className="lbl">变更说明<span className="req">必填</span></label>
              <textarea className="inp" rows={2} placeholder="简要说明本次变更的原因，便于审计追溯" value={note} onChange={(e) => onNote(e.target.value)} />
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>{cancelText}</button>
          <button className={'btn ' + (tone === 'danger' ? 'danger' : '')} onClick={onConfirm} disabled={busy || (requireNote && !note?.trim())}>
            {busy ? <><Spin />处理中…</> : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export function UnsavedChangesDialog({ open, onStay, onLeave }) {
  if (!open) return null;
  return (
    <div className="scrim" onClick={onStay}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div className="modal-h">
          <div className="mi warn"><Icon id="warn" size={19} /></div>
          <div><div className="mt">离开此页面？</div><div className="md">当前修改尚未保存，离开后将丢失这些改动。</div></div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onStay}>留在本页</button>
          <button className="btn danger" onClick={onLeave}>放弃并离开</button>
        </div>
      </div>
    </div>
  );
}

export function SessionExpiredDialog({ open, onRelogin }) {
  if (!open) return null;
  return (
    <div className="scrim">
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-h">
          <div className="mi info"><Icon id="clock" size={19} /></div>
          <div><div className="mt">登录状态已过期</div><div className="md">为保障账号安全，你的登录会话已超时。请重新登录后继续操作。</div></div>
        </div>
        <div className="modal-foot">
          <button className="btn lg" onClick={onRelogin} style={{ width: 'auto' }}>重新登录</button>
        </div>
      </div>
    </div>
  );
}

export function ToastHost({ toasts }) {
  return (
    <div className="toast-wrap">
      {toasts.map((t) => <div key={t.id} className={'toast ' + t.kind}><span className="td" />{t.text}</div>)}
    </div>
  );
}
