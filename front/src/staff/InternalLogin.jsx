// InternalLogin.jsx — 内部后台统一登录页。
// DOM / 类名 / 文案逐字移植自 prototype-admin/login.jsx（组件内 <style> 已移入 internal.css）。
//
// 两处必要的落地改动，均在注释处标明：
// 1. 早期原型使用过硬编码演示账号；当前版本已删除该登录方式。
//    这里换成真实 Supabase Auth；角色不由前端判定，登录后由 GET /api/internal/me 返回。
//    「账号禁用」也不再靠前端表查，而是后端 403 —— 见 StaffAuthProvider 的 forbidden 态。
// 2. 原型底部曾展示演示凭据。当前仅保留提示块结构与样式，
//    内容换成真实的开通指引 —— 把不存在的凭证印在真实登录页上既误导也不安全。
//
// 登录页恒为文艺主题（theme-lit）：此时尚不知道角色，与原型一致。

import { useState } from 'react';
import { useStaffAuth } from '../auth/staffAuth';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { Spin } from './shared/ui';

export default function InternalLogin({ sessionExpiredHint }) {
  const { signIn, error: authError } = useStaffAuth();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);

  // 忘记密码子视图
  const [resetEmail, setResetEmail] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetBanner, setResetBanner] = useState(null);

  // 会话过期提示优先展示，一旦用户开始尝试登录就让位给真实错误。
  const err = authError
    ? { kind: 'err', text: authError }
    : (sessionExpiredHint && !hintDismissed ? { kind: 'info', text: '登录状态已过期，请重新登录。' } : null);

  async function submit(e) {
    e && e.preventDefault();
    if (!email.trim() || !pw || busy) return;
    setBusy(true);
    setHintDismissed(true);
    await signIn(email, pw);
    setBusy(false);
  }

  async function sendReset() {
    const target = resetEmail.trim();
    if (!target || resetBusy) return;
    if (!isSupabaseConfigured) {
      setResetBanner({ kind: 'err', text: '前端未配置 Supabase，无法发送重置邮件。' });
      return;
    }
    setResetBusy(true);
    setResetBanner(null);
    const { error } = await supabase.auth.resetPasswordForEmail(target);
    setResetBusy(false);
    setResetBanner(error
      ? { kind: 'err', text: error.message || '重置链接发送失败，请稍后重试。' }
      : { kind: 'ok', text: '重置链接已发送，请查收工作邮箱。' });
  }

  return (
    <div className="login-stage theme-lit">
      <div className="login-art">
        <div className="grid-lines" />
        <div style={{ position: 'relative' }}>
          <div className="seal">轻</div>
          <div className="la-k" style={{ marginTop: 24 }}>轻阅读 · 内部人员系统</div>
          <h1>编辑部的<br />技术与内容中枢</h1>
          <div className="la-p">面向平台管理员、编辑部负责人与审稿编辑的统一入口。登录后依据账号角色进入对应工作台。</div>
        </div>
        <div style={{ position: 'relative' }}>
          <div className="roles">
            <div className="rrow"><span className="rdot" style={{ background: '#4E97C9' }} />平台管理员 · 技术与安全配置</div>
            <div className="rrow"><span className="rdot" style={{ background: '#C77A5A' }} />编辑部负责人 · 编辑规则与内容策略</div>
            <div className="rrow"><span className="rdot" style={{ background: '#5F9E86' }} />审稿编辑 · 稿件审读与推荐</div>
          </div>
          <div className="la-foot" style={{ marginTop: 28 }}>© 2026 轻阅读 · 仅限授权内部人员访问</div>
        </div>
      </div>

      <div className="login-form-wrap">
        {!forgot ? (
          <form className="login-form fade-in" onSubmit={submit}>
            <div className="lf-eyebrow">— Internal Sign In —</div>
            <h2>内部登录</h2>
            <div className="lf-sub">请使用你的工作邮箱登录。系统将依据账号角色引导至对应工作台。</div>
            {err && <div className={'banner ' + err.kind} style={{ marginBottom: 18 }}><span className="bd" /><span className="bx">{err.text}</span></div>}
            <div className="fld">
              <label className="lbl" style={{ color: 'var(--ink-3)' }}>工作邮箱</label>
              <input className="inp" type="email" value={email} placeholder="name@qingyue.internal" autoComplete="username" spellCheck={false} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="fld">
              <label className="lbl" style={{ color: 'var(--ink-3)' }}>密码
                <button type="button" className="forgot" style={{ marginLeft: 'auto' }} onClick={() => { setResetEmail(email); setResetBanner(null); setForgot(true); }}>忘记密码？</button>
              </label>
              <div className="inp-wrap">
                <input className="inp" type={showPw ? 'text' : 'password'} value={pw} placeholder="请输入密码" autoComplete="current-password" style={{ paddingRight: 60 }} onChange={(e) => setPw(e.target.value)} />
                <button type="button" className="reveal" onClick={() => setShowPw((s) => !s)}>{showPw ? '隐藏' : '显示'}</button>
              </div>
            </div>
            <button className="btn lg" type="submit" disabled={!email.trim() || !pw || busy} style={{ marginTop: 6 }}>
              {busy ? <><Spin />登录中…</> : '登录'}
            </button>
            {/* 结构同原型的「演示账号」块；内容换为真实开通指引 */}
            <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--rule)', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.7 }}>
              <b style={{ color: 'var(--ink-2)', fontWeight: 500 }}>没有账号？</b><br />
              内部账号由平台管理员统一开通并分配角色，不支持自助注册。
            </div>
          </form>
        ) : (
          <div className="login-form fade-in">
            <div className="lf-eyebrow">— Reset Password —</div>
            <h2>找回密码</h2>
            <div className="lf-sub">输入你的工作邮箱，我们将发送重置链接。内部账号也可直接联系平台管理员重置。</div>
            {resetBanner && <div className={'banner ' + resetBanner.kind} style={{ marginBottom: 18 }}><span className="bd" /><span className="bx">{resetBanner.text}</span></div>}
            <div className="fld">
              <label className="lbl" style={{ color: 'var(--ink-3)' }}>工作邮箱</label>
              <input className="inp" type="email" placeholder="name@qingyue.internal" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} />
            </div>
            <button className="btn lg" onClick={sendReset} disabled={!resetEmail.trim() || resetBusy}>
              {resetBusy ? <><Spin />发送中…</> : '发送重置链接'}
            </button>
            <button className="forgot" style={{ marginTop: 16, display: 'block' }} onClick={() => setForgot(false)}>← 返回登录</button>
          </div>
        )}
      </div>
    </div>
  );
}
