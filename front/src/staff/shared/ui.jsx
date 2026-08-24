// ui.jsx — 内部后台通用小组件与状态盒。
// DOM 结构与类名逐字移植自 prototype-admin/shared.jsx，未用任何通用组件近似替代。

import { useState } from 'react';
import Icon from './Icon';
import { ROLES, STAFF_STATUS, PROMPT_STATUS } from './constants';

export function Spin() {
  return <span className="spin" />;
}

export function RoleBadge({ role }) {
  const r = ROLES[role];
  return <span className={'rolebadge ' + role}><span className="rb-d" />{r.name}</span>;
}

export function StatusBadge({ kind, children }) {
  return <span className={'badge ' + kind}><span className="bd" />{children}</span>;
}

export function VersionBadge({ v, label }) {
  return <span className="verbadge">{label && <span className="vp">{label}</span>}{v}</span>;
}

/** 员工状态 / Prompt 状态徽章的字典化写法，供表格直接调用 */
export function StaffStatusBadge({ status }) {
  const [kind, text] = STAFF_STATUS[status];
  return <StatusBadge kind={kind}>{text}</StatusBadge>;
}
export function PromptStatusBadge({ status }) {
  const [kind, text] = PROMPT_STATUS[status];
  return <StatusBadge kind={kind}>{text}</StatusBadge>;
}

/* 掩码密钥字段 —— 永不展示完整密钥 */
export function MaskedSecretField({ masked, value, onChange, editing, onEdit, placeholder = '留空表示不修改原密钥' }) {
  const [show, setShow] = useState(false);
  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="mono" style={{ fontSize: 13, color: 'var(--ink-2)', letterSpacing: '.04em' }}>{masked || '— 未设置 —'}</span>
        <button className="btn ghost sm" onClick={onEdit}><Icon id="key" size={13} className="btn-ico" />更新密钥</button>
      </div>
    );
  }
  return (
    <div className="inp-wrap">
      <input className="inp mono" type={show ? 'text' : 'password'} value={value} placeholder={placeholder}
        autoComplete="new-password" spellCheck={false} style={{ paddingRight: 60 }} onChange={(e) => onChange(e.target.value)} />
      <button className="reveal" onClick={() => setShow((s) => !s)}>{show ? '隐藏' : '显示'}</button>
    </div>
  );
}

/* 状态盒：空 / 错误 / 加载 / 无权限 / 404 */
export function EmptyState({ icon = 'empty', title = '暂无数据', desc, action }) {
  return (
    <div className="state-box">
      <div className="sb-ico"><Icon id={icon} size={52} /></div>
      <div className="sb-t">{title}</div>
      {desc && <div className="sb-d">{desc}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ title = '加载失败', desc = '请检查网络连接后重试。', onRetry }) {
  return (
    <div className="state-box">
      <div className="sb-ico" style={{ color: 'var(--danger)' }}><Icon id="warn" size={52} /></div>
      <div className="sb-t">{title}</div>
      <div className="sb-d">{desc}</div>
      {onRetry && <button className="btn ghost" onClick={onRetry}><Icon id="refresh" size={14} className="btn-ico" />重试</button>}
    </div>
  );
}

export function LoadingState({ rows = 3 }) {
  return (
    <div style={{ padding: '8px 0' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel" style={{ height: 52, marginBottom: 10, opacity: 1 - i * 0.18 }} />
      ))}
    </div>
  );
}

export function ForbiddenState() {
  return (
    <div className="state-box" style={{ padding: '80px 30px' }}>
      <div className="sb-ico" style={{ color: 'var(--warn)' }}><Icon id="forbidden" size={52} /></div>
      <div className="sb-t">无权访问此页面</div>
      <div className="sb-d">当前角色没有访问该模块的权限。若确有需要，请联系平台管理员调整你的角色。</div>
    </div>
  );
}

export function NotFoundState({ onHome }) {
  return (
    <div className="state-box" style={{ padding: '80px 30px' }}>
      <div className="numf" style={{ fontSize: 64, color: 'var(--ink-4)', lineHeight: 1, marginBottom: 10 }}>404</div>
      <div className="sb-t">页面不存在</div>
      <div className="sb-d">你访问的页面可能已被移动或删除。</div>
      {onHome && <button className="btn" onClick={onHome}>返回工作台</button>}
    </div>
  );
}
