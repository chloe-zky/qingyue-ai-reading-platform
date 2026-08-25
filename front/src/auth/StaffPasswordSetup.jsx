import { useMemo, useState } from 'react';
import { AUTH_STATUS, STAFF_AUTH_ACTION, useStaffAuth } from './staffAuth';
import { Spin } from '../staff/shared/ui';
import { MSpin } from '../staff/mobile/core';

function passwordIssue(password, confirmation) {
  if (password.length < 10) return '密码至少需要 10 个字符。';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return '密码需要同时包含字母和数字。';
  if (password !== confirmation) return '两次输入的密码不一致。';
  return '';
}

function Fields({ password, confirmation, setPassword, setConfirmation, show, setShow }) {
  return (
    <>
      <div className="fld">
        <label className="lbl">新密码</label>
        <div className="inp-wrap">
          <input className="inp" type={show ? 'text' : 'password'} value={password}
            placeholder="至少 10 位，包含字母和数字" autoComplete="new-password"
            style={{ paddingRight: 60 }} onChange={(event) => setPassword(event.target.value)} />
          <button type="button" className="reveal" onClick={() => setShow((value) => !value)}>{show ? '隐藏' : '显示'}</button>
        </div>
      </div>
      <div className="fld">
        <label className="lbl">确认新密码</label>
        <input className="inp" type={show ? 'text' : 'password'} value={confirmation}
          placeholder="再次输入新密码" autoComplete="new-password"
          onChange={(event) => setConfirmation(event.target.value)} />
      </div>
    </>
  );
}

export default function StaffPasswordSetup({ mobile = false }) {
  const { status, authAction, hasSession, completePasswordSetup, cancelPasswordSetup } = useStaffAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const issue = useMemo(() => passwordIssue(password, confirmation), [password, confirmation]);
  const isInvite = authAction === STAFF_AUTH_ACTION.INVITE;
  const isCheckingLink = !hasSession && status === AUTH_STATUS.LOADING;
  const title = isInvite ? '设置登录密码' : '更新登录密码';
  const subtitle = !hasSession
    ? isCheckingLink
      ? '系统正在安全验证邮件中的一次性链接，请稍候。'
      : '这封邮件中的一次性链接当前无法继续使用。'
    : isInvite
    ? '邀请已经确认。设置密码后，系统会自动识别你的角色并进入工作台。'
    : '身份已经确认。设置新密码后即可继续进入内部工作台。';

  async function submit(event) {
    event?.preventDefault();
    if (issue || busy || !hasSession) return;
    setBusy(true);
    setMessage('');
    const result = await completePasswordSetup(password);
    if (!result.ok) setMessage(result.error);
    setBusy(false);
  }

  const banner = hasSession
    ? message
    : isCheckingLink
      ? '正在确认链接，请不要关闭当前页面。'
      : '此链接无效、已过期或已被使用，请返回登录；如仍需设置密码，请联系平台管理员重新发送。';
  const bannerIsError = Boolean(message) || (!hasSession && !isCheckingLink);

  const form = (
    <form onSubmit={submit}>
      <div style={{ fontFamily: 'var(--num)', textTransform: 'uppercase', letterSpacing: '.22em', fontSize: 10, color: 'var(--accent)', marginBottom: 10 }}>— Secure Account Setup —</div>
      <div style={{ fontFamily: 'var(--serif)', fontWeight: 600, fontSize: mobile ? 22 : 26, marginBottom: 8 }}>{title}</div>
      <div className={mobile ? 'lead-p' : 'lf-sub'}>{subtitle}</div>
      {banner && <div className={'banner ' + (bannerIsError ? 'err' : 'info')} style={{ marginBottom: 18 }}><span className="bd" /><span className="bx">{banner}</span></div>}
      <Fields password={password} confirmation={confirmation} setPassword={setPassword}
        setConfirmation={setConfirmation} show={show} setShow={setShow} />
      {password && confirmation && issue && <div style={{ color: 'var(--danger)', fontSize: 12, margin: '-8px 0 14px' }}>{issue}</div>}
      <button className={mobile ? 'btn' : 'btn lg'} type="submit" disabled={Boolean(issue) || busy || !hasSession}>
        {busy ? <>{mobile ? <MSpin /> : <Spin />}保存中…</> : '保存并进入工作台'}
      </button>
      <button type="button" className={mobile ? 'reveal' : 'forgot'}
        style={{ position: 'static', display: 'block', margin: '16px auto 0', textTransform: 'none', letterSpacing: 0 }}
        onClick={cancelPasswordSetup}>返回登录</button>
    </form>
  );

  if (mobile) {
    return (
      <div className="app theme-lit fade-in">
        <div className="scroll" style={{ background: 'var(--paper)' }}>
          <div style={{ background: 'linear-gradient(160deg,#2B211C,#3D2F26 65%,#5A4433)', color: '#E5D8C6', padding: '70px 24px 34px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, opacity: .06, backgroundImage: 'linear-gradient(#E5D8C6 1px,transparent 1px)', backgroundSize: '100% 30px' }} />
            <div style={{ position: 'relative' }}>
              <div style={{ width: 40, height: 40, border: '1.5px solid #8B6F58', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--num)', fontSize: 18 }}>轻</div>
              <div style={{ fontFamily: 'var(--num)', fontStyle: 'italic', fontSize: 13, color: '#A79582', margin: '20px 0 12px', letterSpacing: '.04em' }}>轻阅读 · 内部人员系统</div>
              <div style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 29, lineHeight: 1.35, letterSpacing: '.03em' }}>欢迎加入<br />轻阅读 Studio</div>
            </div>
          </div>
          <div className="pad" style={{ paddingTop: 22 }}>{form}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-stage theme-lit">
      <div className="login-art">
        <div className="grid-lines" />
        <div style={{ position: 'relative' }}>
          <div className="seal">轻</div>
          <div className="la-k" style={{ marginTop: 24 }}>轻阅读 · 内部人员系统</div>
          <h1>欢迎加入<br />轻阅读 Studio</h1>
          <div className="la-p">完成最后一步安全设置后，系统会依据你的工作职责进入对应工作台。</div>
        </div>
        <div className="la-foot" style={{ position: 'relative' }}>邀请仅限本人使用 · 密码不会发送给平台管理员</div>
      </div>
      <div className="login-form-wrap"><div className="login-form fade-in">{form}</div></div>
    </div>
  );
}
