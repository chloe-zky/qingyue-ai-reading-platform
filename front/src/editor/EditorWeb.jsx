// EditorWeb.jsx — 审稿编辑部 · 网页版（桌面批量审稿）。
// DOM / 类名逐屏移植自 prototype-studio/editor-web.jsx；接后端真实数据。
// 屏幕：欢迎页 → 账号密码登录 → 审稿页（列表平铺为卡片，卡内分阶段）。
//
// 两阶段审稿（卡内 stage）：
//   review  初审：只读正文 + 三选一（拒稿 / 提交修改意见 / 通过初审·收稿 →）
//   reject  拒稿说明：理由 textarea，空则禁用确认
//   revise  修改意见：意见 textarea，空则禁用确认
//   process 收稿后：「已收稿」提示 + 配图与打标左右分栏 + 确认发布；可退回初审
// 未收稿前不渲染配图与打标模块。
//
// 独立阅读页：正文区「阅读全文 ›」→ 居中阅读浮层 .reader-ov / .reader-sheet。

import { useRef, useState } from 'react';

const FIXED_TAGS = {
  setting:      { k: '时代设定', en: 'setting', opts: ['现代', '古风', '民国'] },
  story_tone:   { k: '故事基调', en: 'story_tone', opts: ['清甜校园', '遗憾青春', '温暖治愈', '浓情曲折'] },
  relationship: { k: '关系内核', en: 'relationship', opts: ['暗恋未明', '久别重逢', '相伴成长', '命运拉扯'] },
};

function WelcomePage({ onEnter }) {
  return (
    <div className="scroll fade-in" onClick={onEnter} style={{ cursor: 'pointer' }}>
      <div className="center-wrap">
        <div className="welcome-card">
          <div className="seal">❧</div>
          <div className="eyebrow c">— Editorial · 编 辑 部 —</div>
          <h2 className="big c">审稿编辑部</h2>
          <p className="lead c">读稿、配图、定标签，决定一篇作品是否与读者相见。</p>
          <div className="hint">轻触任意处 · 登录</div>
          <div className="foot">仅限编辑与管理员 · Internal Use Only</div>
        </div>
      </div>
    </div>
  );
}

function LoginPage({ onLogin, msg }) {
  const [acct, setAcct] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await onLogin(acct, pw);
    if (!ok) setBusy(false);
  };
  return (
    <div className="scroll fade-in">
      <div className="center-wrap">
        <div className="login-card">
          <div className="eyebrow">— Sign in · 登 录 —</div>
          <h3>欢迎回来</h3>
          <p className="sub">用编辑部为您分配的账号登录。</p>
          {msg && (
            <div className={'msg ' + (msg.kind === 'ok' ? 'ok' : 'err')} style={{ marginBottom: 18 }}>
              <span className="d" />{msg.text}
            </div>
          )}
          <div className="fld"><label className="lbl">Account · 编辑账号</label>
            <input className="inp" value={acct} placeholder="工号 或 邮箱"
              onChange={(e) => setAcct(e.target.value)} /></div>
          <div className="fld"><label className="lbl">Password · 密码</label>
            <input className="inp" type="password" value={pw} placeholder="登录密码"
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()} /></div>
          <div className="login-opts">
            <span>记住此设备</span>
            <button className="btn link" type="button">忘记密码？</button>
          </div>
          <button className="btn block" onClick={submit} disabled={busy}>{busy ? '登录中…' : '登 录'}</button>
        </div>
      </div>
    </div>
  );
}

function CoverModule({ sub, core }) {
  const c = sub.cover;
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');

  const pick = () => inputRef.current?.click();
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr('');
    setUploading(true);
    try {
      await core.uploadCover(sub, file);
    } catch (ex) {
      setErr(ex.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };
  const setField = (k, v) => core.change({ ...sub, cover: { ...sub.cover, [k]: v } });
  const remove = () => core.change({ ...sub, cover: null });

  return (
    <div className="mod">
      <div className="mod-h"><span className="mt">编辑配图</span><span className="mk">Cover</span></div>
      <p className="mod-hint">由编辑部统一处理。仅用于前台展示，不参与 AI 分析。JPEG / PNG / WebP，最大 5MB。</p>
      {!c && (
        <div className="upload-empty">
          <button className="btn soft" onClick={pick} disabled={uploading}>
            {uploading ? '上传中…' : '上传文章图片'}
          </button>
        </div>
      )}
      {c && (
        <>
          <div className="cover-thumb">
            <span className="imgtag">Cover</span>
            {c.url && <img src={c.url} alt={`${sub.title} 配图`} />}
          </div>
          <div className="fld"><label className="lbl">摄影师 / 图片作者姓名</label>
            <input className="inp" value={c.photographer} placeholder="例如：摄影 / 林夏"
              onChange={(e) => setField('photographer', e.target.value)} /></div>
          <div className="fld" style={{ marginBottom: 0 }}><label className="lbl">图片下方一句话说明</label>
            <textarea className="inp" value={c.caption} placeholder="例如：风从旧街尽头吹来，像一封迟到的信。"
              onChange={(e) => setField('caption', e.target.value)} /></div>
          <div className="cover-url">{c.url}</div>
          <div className="cover-actions">
            <button className="btn link" onClick={pick} disabled={uploading}>
              {uploading ? '上传中…' : '重新选择图片'}
            </button>
            <button className="btn link danger" onClick={remove} disabled={uploading}>移除</button>
          </div>
        </>
      )}
      {err && <div className="msg err" style={{ marginTop: 12, marginBottom: 0 }}><span className="d" />{err}</div>}
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
    </div>
  );
}

function ReaderOverlay({ sub, onClose }) {
  const paras = (sub.full_content || '（暂无全文）').split(/\n+/).filter(Boolean);
  return (
    <div className="reader-ov" onClick={onClose}>
      <div className="reader-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="reader-bar">
          <span className="rt">Reading · 阅读</span>
          <button className="close" onClick={onClose}>关闭 ✕</button>
        </div>
        <div className="reader-scroll">
          <div className="reader-body">
            <div className="r-meta">Manuscript · 全文</div>
            <h1>《{sub.title}》</h1>
            <div className="r-by">{sub.author}</div>
            <div className="r-epi">{sub.intro}</div>
            <div className="r-rule" />
            <div className="r-body">{paras.map((p, i) => <p key={i}>{p}</p>)}</div>
            <div className="r-end">· 全文完 ·</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SubmissionCard({ sub, core, onRead }) {
  const [stage, setStage] = useState('review'); // review | reject | revise | process
  const [reason, setReason] = useState('');
  const [revision, setRevision] = useState('');
  const [busy, setBusy] = useState(false);
  const t = sub.tags;
  const toggleTag = (cat, val) => {
    const cur = t[cat];
    const next = cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val];
    core.change({ ...sub, tags: { ...t, [cat]: next } });
  };
  const setField = (k, v) => core.change({ ...sub, tags: { ...t, [k]: v } });

  // 稿件在提交成功后即被移出列表；失败则留在原阶段，仅解除 busy。
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    await fn();
    setBusy(false);
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="title">《{sub.title}》 <span className="by">/ {sub.author}</span></div>
          <div className="meta-row">
            <span className="chip">ID · {sub.book_id}</span>
            <span className="chip stat">{stage === 'process' ? '已收稿' : '待初审'}</span>
            <span className="chip src">标签源 · {sub.tag_source}</span>
          </div>
        </div>
      </div>

      {/* 稿件正文（两阶段都可见）*/}
      <div className="field-line"><div className="fl-k">扉页语 / 卷首短句</div><div className="fl-v serif">{sub.intro}</div></div>
      <div className="field-line"><div className="fl-k">内容简介 / 故事概览</div><div className="fl-v">{sub.sample}</div></div>
      <button className="btn soft" style={{ marginTop: 4 }} onClick={() => onRead(sub)}>阅读全文 ›</button>

      {/* ── 阶段一：初审决定 ── */}
      {stage === 'review' && (
        <div className="mod" style={{ marginTop: 18 }}>
          <div className="mod-h"><span className="mt">初审决定</span><span className="mk">Decision</span></div>
          <p className="mod-hint">先判断这篇是否合格：合格则收稿，进入配图与打标；否则退回修改或拒稿。</p>
          <div className="card-foot" style={{ border: 0, padding: 0, margin: 0 }}>
            <button className="btn link danger" onClick={() => setStage('reject')}>拒稿</button>
            <button className="btn ghost" onClick={() => setStage('revise')}>提交修改意见</button>
            <button className="btn" onClick={() => setStage('process')}>通过初审 · 收稿 →</button>
          </div>
        </div>
      )}

      {/* ── 拒稿 ── */}
      {stage === 'reject' && (
        <div className="mod" style={{ marginTop: 18 }}>
          <div className="mod-h"><span className="mt">拒稿说明</span><span className="mk">Reject</span></div>
          <p className="mod-hint">请写明拒稿理由，将随结果回给作者。</p>
          <textarea className="inp" value={reason} placeholder="例如：题材与本刊方向不符；结构尚不完整，建议大幅修改后再投。"
            style={{ minHeight: 96 }} onChange={(e) => setReason(e.target.value)} />
          <div className="card-foot">
            <button className="btn link" onClick={() => setStage('review')}>返回</button>
            <button className="btn" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
              disabled={busy || !reason.trim()} onClick={() => run(() => core.reject(sub, reason))}>
              {busy ? '提交中…' : '确认拒稿并回复作者'}
            </button>
          </div>
        </div>
      )}

      {/* ── 修改意见 ── */}
      {stage === 'revise' && (
        <div className="mod" style={{ marginTop: 18 }}>
          <div className="mod-h"><span className="mt">修改意见</span><span className="mk">Revision</span></div>
          <p className="mod-hint">退回作者修改，稿件保留待其再次提交。</p>
          <textarea className="inp" value={revision} placeholder="例如：故事尾声略仓促，可考虑展开林夏在车站的那段。"
            style={{ minHeight: 96 }} onChange={(e) => setRevision(e.target.value)} />
          <div className="card-foot">
            <button className="btn link" onClick={() => setStage('review')}>返回</button>
            <button className="btn" disabled={busy || !revision.trim()} onClick={() => run(() => core.revise(sub, revision))}>
              {busy ? '提交中…' : '提交修改意见 · 退回作者'}
            </button>
          </div>
        </div>
      )}

      {/* ── 阶段二：收稿后 · 配图 + 标签 ── */}
      {stage === 'process' && (
        <>
          <div className="msg ok" style={{ margin: '18px 0 16px' }}><span className="d" />已收稿 · 本篇通过初审，继续配图与定标签。</div>
          <div className="cols">
            <CoverModule sub={sub} core={core} />
            <div className="mod">
              <div className="mod-h"><span className="mt">AI 标签确认与修改</span><span className="mk">Tags</span></div>
              <p className="mod-hint">三组核心标签为固定词表；美学与风险为自由文本（逗号分隔）。</p>
              {Object.keys(FIXED_TAGS).map((cat) => (
                <div key={cat} className="tag-group">
                  <div className="tg-k">{FIXED_TAGS[cat].k}<span className="en">{FIXED_TAGS[cat].en}</span></div>
                  <div className="tag-set">
                    {FIXED_TAGS[cat].opts.map((o) => (
                      <span key={o} className={'tag' + (t[cat].includes(o) ? ' on' : '')} onClick={() => toggleTag(cat, o)}>{o}</span>
                    ))}
                  </div>
                </div>
              ))}
              <div className="fld fld-mt"><label className="lbl">美学标签（逗号分隔）</label>
                <input className="inp" value={t.aesthetic} placeholder="电影感, 旧胶片"
                  onChange={(e) => setField('aesthetic', e.target.value)} /></div>
              <div className="fld"><label className="lbl">风险提示（逗号分隔）</label>
                <input className="inp" value={t.risk} placeholder="轻微虐"
                  onChange={(e) => setField('risk', e.target.value)} /></div>
              <div className="fld" style={{ marginBottom: 0 }}><label className="lbl">编辑推荐理由</label>
                <textarea className="inp" value={t.reason} placeholder="一句话，告诉读者这篇好在哪里。"
                  onChange={(e) => setField('reason', e.target.value)} /></div>
            </div>
          </div>
          <div className="card-foot">
            {!sub.cover && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>尚未配图（可跳过）</span>}
            <button className="btn link" onClick={() => setStage('review')}>退回初审</button>
            <button className="btn approve" disabled={busy} onClick={() => run(() => core.approve(sub))}>
              {busy ? '发布中…' : '✓ 确认发布，入推荐池'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function EditorHome({ core, onLogout, onRead, exitLabel = '退出' }) {
  const { user, subs, msg } = core;
  return (
    <>
      <div className="topbar">
        <div className="brand">审稿编辑部<span className="mut">Editorial Studio</span></div>
        <div className="rhs">
          <button className="link" onClick={core.reload}>刷新</button>
          <div className="who"><span className="av" />{user}</div>
          <button className="link" onClick={onLogout}>{exitLabel}</button>
        </div>
      </div>
      <div className="scroll fade-in">
        <div className="wrap">
          <div className="eyebrow">— Editor · 审 稿 编 辑 部 —</div>
          <h2 className="big">待审稿件</h2>
          <p className="lead">读稿、配图、定标签，决定一篇作品是否进入推荐池。</p>
          <div style={{ height: 18 }} />
          {msg && (
            <div className={'msg ' + (msg.kind === 'ok' ? 'ok' : 'err')}>
              <span className="d" />{msg.text}
            </div>
          )}
          <div className="countbar">
            <span className="sect-label">Pending · {subs.length} 篇待审</span>
          </div>
          {subs.length === 0 && <div className="empty"><div className="ico">✓</div>所有稿件已处理完毕。</div>}
          {subs.map((s) => <SubmissionCard key={s.book_id} sub={s} core={core} onRead={onRead} />)}
        </div>
      </div>
    </>
  );
}

export default function EditorWeb({ core, onExit }) {
  // 已登录（core.token 存在）则直接进审稿页，否则从欢迎页开始。
  const [view, setView] = useState(core.token ? 'editor' : 'welcome');
  const [readingId, setReadingId] = useState(null);

  const doLogin = async (acct, pw) => {
    const ok = await core.login(acct, pw);
    if (ok) setView('editor');
    return ok;
  };
  const doLogout = () => {
    setReadingId(null);
    if (onExit) {
      onExit();
      return;
    }
    core.logout();
    setView('welcome');
  };

  let body;
  if (view === 'welcome') body = <WelcomePage onEnter={() => { core.setMsg(null); setView('login'); }} />;
  else if (view === 'login') body = <LoginPage onLogin={doLogin} msg={core.msg} />;
  else body = <EditorHome core={core} onLogout={doLogout} exitLabel={onExit ? '返回后台' : '退出'} onRead={(s) => setReadingId(s.book_id)} />;

  // 阅读浮层覆盖整个编辑器容器（.ecx-web 已 position:relative）。
  const reading = readingId != null ? core.subs.find((s) => s.book_id === readingId) : null;

  return (
    <div className="ecx-web">
      {body}
      {reading && <ReaderOverlay sub={reading} onClose={() => setReadingId(null)} />}
    </div>
  );
}
