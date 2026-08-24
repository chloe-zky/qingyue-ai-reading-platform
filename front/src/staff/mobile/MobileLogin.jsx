// MobileLogin.jsx — 手机端内部登录页。
// DOM / 类名 / 内联样式逐字移植自 prototype-admin/mobile-core.jsx 的 MobileLogin。
//
// 与桌面 InternalLogin 同样的两处落地改动：
// 1. 原型的硬编码 M_LOGIN 演示登录换成真实 Supabase Auth；角色由后端
//    GET /api/internal/me 返回，账号禁用由后端 403 表达，不在前端表里判定。
// 2. 早期演示凭据已删除，底部提示块改成真实账号开通指引。
//
// 登录页恒为文艺主题（theme-lit），与原型一致 —— 此时尚不知道角色。

import { useState } from 'react';
import { useStaffAuth } from '../../auth/staffAuth';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';
import { MSpin } from './core';

export default function MobileLogin({ hint }) {
  const { signIn, error: authError } = useStaffAuth();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);

  const [resetEmail, setResetEmail] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetBanner, setResetBanner] = useState(null);

  const err = authError
    ? { kind: 'err', text: authError }
    : (hint && !hintDismissed ? { kind: 'info', text: '登录状态已过期，请重新登录。' } : null);

  async function submit() {
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
    <div className="app theme-lit fade-in">
      <div className="scroll" style={{ background: 'var(--paper)' }}>
        {/* 文艺封面头 */}
        <div style={{ background: 'linear-gradient(160deg,#2B211C,#3D2F26 65%,#5A4433)', color: '#E5D8C6', padding: '70px 24px 34px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, opacity: .06, backgroundImage: 'linear-gradient(#E5D8C6 1px,transparent 1px)', backgroundSize: '100% 30px' }} />
          <div style={{ position: 'relative' }}>
            <div style={{ width: 40, height: 40, border: '1.5px solid #8B6F58', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--num)', fontSize: 18 }}>轻</div>
            <div style={{ fontFamily: 'var(--num)', fontStyle: 'italic', fontSize: 13, color: '#A79582', margin: '20px 0 12px', letterSpacing: '.04em' }}>轻阅读 · 内部人员系统</div>
            <div style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 29, lineHeight: 1.35, letterSpacing: '.03em' }}>编辑部的<br />技术与内容中枢</div>
          </div>
        </div>
        {!forgot ? (
          <div className="pad" style={{ paddingTop: 22 }}>
            <div style={{ fontFamily: 'var(--num)', textTransform: 'uppercase', letterSpacing: '.22em', fontSize: 10, color: 'var(--accent)', marginBottom: 10 }}>— Internal Sign In —</div>
            <div style={{ fontFamily: 'var(--serif)', fontWeight: 600, fontSize: 22, marginBottom: 6 }}>内部登录</div>
            <div className="lead-p">请使用工作邮箱登录，系统将依账号角色进入对应工作台。</div>
            {err && <div className={'banner ' + err.kind} style={{ marginBottom: 16 }}><span className="bd" /><span className="bx">{err.text}</span></div>}
            <div className="fld"><label className="lbl">工作邮箱</label><input className="inp" type="email" value={email} placeholder="name@qingyue.internal" autoComplete="username" spellCheck={false} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="fld"><label className="lbl">密码
              <button className="reveal" style={{ position: 'static', marginLeft: 'auto', textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-3)' }} onClick={() => { setResetEmail(email); setResetBanner(null); setForgot(true); }}>忘记密码？</button></label>
              <div className="inp-wrap"><input className="inp" type={show ? 'text' : 'password'} value={pw} placeholder="请输入密码" autoComplete="current-password" style={{ paddingRight: 58 }} onChange={(e) => setPw(e.target.value)} /><button className="reveal" onClick={() => setShow((s) => !s)}>{show ? '隐藏' : '显示'}</button></div>
            </div>
            <button className="btn" onClick={submit} disabled={!email.trim() || !pw || busy} style={{ marginTop: 4 }}>{busy ? <><MSpin />登录中…</> : '登录'}</button>
            {/* 结构同原型的「演示账号」块；内容换为真实开通指引 */}
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--rule)', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.7 }}>
              <b style={{ color: 'var(--ink-2)', fontWeight: 500 }}>没有账号？</b><br />内部账号由平台管理员统一开通并分配角色，不支持自助注册。
            </div>
          </div>
        ) : (
          <div className="pad" style={{ paddingTop: 22 }}>
            <div style={{ fontFamily: 'var(--num)', textTransform: 'uppercase', letterSpacing: '.22em', fontSize: 10, color: 'var(--accent)', marginBottom: 10 }}>— Reset Password —</div>
            <div style={{ fontFamily: 'var(--serif)', fontWeight: 600, fontSize: 22, marginBottom: 6 }}>找回密码</div>
            <div className="lead-p">输入工作邮箱，我们将发送重置链接。也可直接联系平台管理员重置。</div>
            {resetBanner && <div className={'banner ' + resetBanner.kind} style={{ marginBottom: 16 }}><span className="bd" /><span className="bx">{resetBanner.text}</span></div>}
            <div className="fld"><label className="lbl">工作邮箱</label><input className="inp" type="email" placeholder="name@qingyue.internal" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} /></div>
            <button className="btn" onClick={sendReset} disabled={!resetEmail.trim() || resetBusy}>{resetBusy ? <><MSpin />发送中…</> : '发送重置链接'}</button>
            <button className="reveal" style={{ position: 'static', display: 'block', margin: '16px auto 0', textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--font-body)', fontSize: 13 }} onClick={() => setForgot(false)}>← 返回登录</button>
          </div>
        )}
      </div>
    </div>
  );
}
