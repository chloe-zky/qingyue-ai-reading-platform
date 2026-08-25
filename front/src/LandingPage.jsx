// LandingPage.jsx — App entry / landing screen.
// 普通用户端入口：hero + 产品名 + 文案 + 登录/注册。
// 编辑 / 管理员入口不再以可见按钮形式出现——通过两种隐藏方式进入工作台：
//   (1) 独立模式：URL 带 `?mode=studio` 或 `#studio`（App.jsx 处理）
//   (2) 隐藏入口：本页面"— 轻 阅 读 —" eyebrow 在 2.5s 内被快速点击 5 次
//
import { useEffect, useRef, useState } from 'react';
import { primeHomePick } from './homePickCache';
import { useReaderAuth } from './reader/ReaderAuthContext';
import heroImage from './assets/hero.png';
import './LandingPage.css';

// 隐藏入口阈值：N 次点击在 windowMs 内触发
const TAP_TRIGGER_COUNT = 5;
const TAP_WINDOW_MS     = 2500;

export default function LandingPage({ onNavigate }) {
  const {
    configured, session, loading, recoveryMode,
    signIn, signUp, signOut, requestPasswordReset, updatePassword, cancelPasswordRecovery,
  } = useReaderAuth();
  const [mode, setMode] = useState(null);
  const [form, setForm] = useState({
    displayName: '', email: '', password: '', confirmPassword: '',
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  // 用 ref 避免触发重渲染——纯粹的累计计数
  const tapTimesRef = useRef([]);

  // 在用户还看着落地页时，悄悄把首页要展示的随机作品 + 封面预拉一次。
  // 这样点"登录"进 UserApp → 首页时，HomeTab 通常已能即刻渲染内容。
  useEffect(() => { primeHomePick(); }, []);

  const handleEyebrowTap = () => {
    const now  = Date.now();
    const keep = tapTimesRef.current.filter((t) => now - t < TAP_WINDOW_MS);
    keep.push(now);
    tapTimesRef.current = keep;
    if (keep.length >= TAP_TRIGGER_COUNT) {
      tapTimesRef.current = [];
      onNavigate('studio');
    }
  };

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const activeMode = recoveryMode ? 'new-password' : mode;

  function passwordIsStrong(password) {
    return password.length >= 10 && /[A-Za-z]/.test(password) && /\d/.test(password);
  }

  async function submit(event) {
    event.preventDefault();
    if (!configured) { setMessage({ kind: 'error', text: '读者登录环境尚未配置。' }); return; }
    if (activeMode === 'recovery') {
      if (!form.email.trim()) { setMessage({ kind: 'error', text: '请填写注册时使用的邮箱。' }); return; }
    } else if (activeMode === 'new-password') {
      if (!form.password || !form.confirmPassword) { setMessage({ kind: 'error', text: '请填写并确认新密码。' }); return; }
      if (!passwordIsStrong(form.password)) { setMessage({ kind: 'error', text: '新密码至少 10 位，并同时包含字母和数字。' }); return; }
      if (form.password !== form.confirmPassword) { setMessage({ kind: 'error', text: '两次输入的密码不一致。' }); return; }
    } else {
      if (!form.email.trim() || !form.password) { setMessage({ kind: 'error', text: '请填写邮箱和密码。' }); return; }
      if (activeMode === 'register' && !form.displayName.trim()) { setMessage({ kind: 'error', text: '请填写昵称。' }); return; }
      if (activeMode === 'register' && !passwordIsStrong(form.password)) { setMessage({ kind: 'error', text: '密码至少 10 位，并同时包含字母和数字。' }); return; }
    }
    setBusy(true); setMessage(null);
    try {
      if (activeMode === 'recovery') {
        await requestPasswordReset(form.email.trim());
        setMessage({ kind: 'ok', text: '如果该邮箱已注册，重置链接会发送到你的邮箱。请在同一设备上打开邮件。' });
      } else if (activeMode === 'new-password') {
        await updatePassword(form.password);
        onNavigate('user');
      } else if (activeMode === 'register') {
        const result = await signUp(form.displayName, form.email.trim(), form.password);
        if (result.needsConfirmation) {
          setMessage({ kind: 'ok', text: '注册成功，请打开验证邮件完成确认后再登录。' });
          setMode('login');
        } else {
          onNavigate('user');
        }
      } else {
        await signIn(form.email.trim(), form.password);
        onNavigate('user');
      }
    } catch (error) {
      setMessage({ kind: 'error', text: error.message || '操作失败，请稍后重试。' });
    } finally { setBusy(false); }
  }

  return (
    <div className="landing-root">
      <div className="landing-frame">

        {/* Hero image */}
        <div
          className="landing-hero"
          style={{ backgroundImage: `url(${heroImage})` }}
        >
          <div className="landing-hero-veil" />
        </div>

        {/* Text block */}
        <div className="landing-body">
          {/* 隐藏入口：本行被快速点击 5 次进入工作台。视觉上与普通眉标无差异。 */}
          <div
            className="landing-eyebrow"
            onClick={handleEyebrowTap}
          >
            — 轻 阅 读 —
          </div>
          <h1 className="landing-title">轻阅读</h1>
          <p className="landing-tagline">
            今晚，读一篇刚好属于你的故事。
          </p>

          {message && <div className={`landing-message is-${message.kind}`}>{message.text}</div>}

          {!activeMode && <div className="landing-actions">
            {loading ? <button className="landing-btn landing-btn-primary" disabled>正在确认登录状态…</button>
              : session ? <>
                <button className="landing-btn landing-btn-primary" onClick={() => onNavigate('user')}>继续阅读</button>
                <button className="landing-btn landing-btn-ghost" onClick={signOut}>退出当前账号</button>
              </> : <>
                <button className="landing-btn landing-btn-primary" onClick={() => { setMode('login'); setMessage(null); }}>登录</button>
                <button className="landing-btn landing-btn-ghost" onClick={() => { setMode('register'); setMessage(null); }}>注册</button>
              </>}
          </div>}

          {activeMode && <form className="landing-auth-form" onSubmit={submit}>
            <div className="landing-auth-title">
              {activeMode === 'register' && '注册读者账号'}
              {activeMode === 'login' && '登录读者账号'}
              {activeMode === 'recovery' && '找回读者密码'}
              {activeMode === 'new-password' && '设置新的密码'}
            </div>
            {activeMode === 'new-password' && <p className="landing-auth-hint">请设置一个新的读者密码。若链接已失效，可返回登录页重新发送。</p>}
            {activeMode === 'register' && <label className="landing-auth-field">昵称<input value={form.displayName} onChange={(e) => setField('displayName', e.target.value)} maxLength={40} autoComplete="nickname" /></label>}
            {(activeMode === 'login' || activeMode === 'register' || activeMode === 'recovery') && <label className="landing-auth-field">邮箱<input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} autoComplete="email" /></label>}
            {activeMode !== 'recovery' && <label className="landing-auth-field">{activeMode === 'new-password' ? '新密码' : '密码'}<input type="password" value={form.password} onChange={(e) => setField('password', e.target.value)} autoComplete={activeMode === 'login' ? 'current-password' : 'new-password'} /></label>}
            {(activeMode === 'register' || activeMode === 'new-password') && <div className="landing-auth-hint">至少 10 位，同时包含字母和数字</div>}
            {activeMode === 'new-password' && <label className="landing-auth-field">确认新密码<input type="password" value={form.confirmPassword} onChange={(e) => setField('confirmPassword', e.target.value)} autoComplete="new-password" /></label>}
            <button className="landing-btn landing-btn-primary" disabled={busy || (activeMode === 'new-password' && loading)}>
              {busy ? '请稍候…' : activeMode === 'register' ? '创建账号' : activeMode === 'login' ? '登录' : activeMode === 'recovery' ? '发送重置邮件' : '保存新密码'}
            </button>
            {activeMode === 'login' && <button type="button" className="landing-auth-switch" onClick={() => { setMode('recovery'); setMessage(null); }}>忘记密码？</button>}
            {(activeMode === 'login' || activeMode === 'register') && <button type="button" className="landing-auth-switch" onClick={() => { setMode(activeMode === 'login' ? 'register' : 'login'); setMessage(null); }}>{activeMode === 'login' ? '还没有账号？去注册' : '已有账号？去登录'}</button>}
            {activeMode === 'recovery' && <button type="button" className="landing-auth-switch" onClick={() => { setMode('login'); setMessage(null); }}>返回登录</button>}
            {activeMode === 'new-password' && <button type="button" className="landing-auth-switch" onClick={async () => { await cancelPasswordRecovery(); setMode('recovery'); setMessage(null); }}>链接已失效？重新发送</button>}
            {activeMode !== 'new-password' && <button type="button" className="landing-auth-switch" onClick={() => { setMode(null); setMessage(null); }}>返回首页</button>}
          </form>}

        </div>

      </div>
    </div>
  );
}
