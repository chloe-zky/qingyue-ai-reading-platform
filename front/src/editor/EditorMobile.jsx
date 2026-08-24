// EditorMobile.jsx — 审稿编辑部 · iOS（手机审稿）。
// DOM / 类名逐屏移植自 prototype-studio/editor-mobile.jsx；接后端真实数据。
// 屏幕：欢迎页 → 账号密码登录 → 待审列表 → 稿件详情（按阶段切换 + 底部固定操作条）。
//
// 两阶段审稿（详情页 stage）：
//   review  初审：只读正文 + 底部三选一（拒稿 / 修改意见 / 通过初审·收稿 →）
//   reject  拒稿说明：理由 textarea，空则底部确认按钮禁用
//   revise  修改意见：意见 textarea，空则底部确认按钮禁用
//   process 收稿后：「已收稿」提示 + 配图与打标 + 确认发布；返回键回初审
// 未收稿前不渲染配图与打标模块。
//
// 独立阅读页：正文区「阅读全文 ›」→ 推入整屏阅读视图，「‹ 返回审稿」返回。

import { useRef, useState } from 'react';

const FIXED_TAGS = {
  setting:      { k: '时代设定', en: 'setting', opts: ['现代', '古风', '民国'] },
  story_tone:   { k: '故事基调', en: 'story_tone', opts: ['清甜校园', '遗憾青春', '温暖治愈', '浓情曲折'] },
  relationship: { k: '关系内核', en: 'relationship', opts: ['暗恋未明', '久别重逢', '相伴成长', '命运拉扯'] },
};

function Toast({ msg }) {
  if (!msg) return null;
  return <div className={'toast ' + (msg.kind === 'ok' ? 'ok' : 'err')}><span className="d" />{msg.text}</div>;
}

// ── 欢迎页 ──
function WelcomeScreen({ onEnter }) {
  return (
    <div className="app fade-in" onClick={onEnter} style={{ cursor: 'pointer' }}>
      <div className="scroll">
        <div className="gate">
          <div className="seal-ico">❧</div>
          <div style={{ fontFamily: 'var(--num)', fontSize: 11, letterSpacing: '.34em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 16 }}>— Editorial · 编 辑 部 —</div>
          <h2 style={{ fontSize: 28 }}>审稿编辑部</h2>
          <p>读稿、配图、定标签，<br />决定一篇作品是否与读者相见。</p>
          <div style={{ marginTop: 6, fontFamily: 'var(--num)', fontSize: 11, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            轻触任意处 · 登录
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 34, marginBottom: 0 }}>
            仅限编辑与管理员 · Internal Use Only
          </p>
        </div>
      </div>
    </div>
  );
}

// ── 登录页（账号 + 密码）──
function LoginScreen({ onBack, onLogin, msg }) {
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
    <div className="app slide-in">
      <div className="nav compact">
        <div className="row">
          <button className="back" onClick={onBack}><span className="chev">‹</span>返回</button>
          <span className="center">编辑登录</span>
          <span style={{ width: 40 }} />
        </div>
        <div className="large" style={{ fontSize: 24 }}><span className="eb">— Sign in · 登 录 —</span>欢迎回来</div>
      </div>
      <div className="scroll">
        <div className="pad" style={{ paddingTop: 24 }}>
          <p style={{ color: 'var(--ink-2)', fontSize: 14, lineHeight: 1.65, marginTop: 0, marginBottom: 26 }}>
            用编辑部为您分配的账号登录。
          </p>
          {msg && <div className={'toast ' + (msg.kind === 'ok' ? 'ok' : 'err')} style={{ margin: '0 0 18px' }}><span className="d" />{msg.text}</div>}
          <div className="fl"><label className="lbl">Account · 编辑账号</label>
            <input className="inp" value={acct} placeholder="工号 或 邮箱" onChange={(e) => setAcct(e.target.value)} /></div>
          <div className="fl" style={{ marginBottom: 8 }}><label className="lbl">Password · 密码</label>
            <input className="inp" type="password" value={pw} placeholder="登录密码"
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 24px' }}>
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>记住此设备</span>
            <button className="linkbtn" style={{ fontSize: 12.5 }} type="button">忘记密码？</button>
          </div>
          <button className="btn" onClick={submit} disabled={busy}>{busy ? '登录中…' : '登 录'}</button>
          <p style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 18, textAlign: 'center' }}>
            登录后会话仅保存在本设备。
          </p>
        </div>
      </div>
    </div>
  );
}

// ── 列表 ──
function ListScreen({ subs, msg, onOpen, onReload, onExit }) {
  return (
    <div className="app fade-in">
      <div className="nav compact">
        <div className="row">
          {onExit ? <button className="back" onClick={onExit}><span className="chev">‹</span>后台</button> : <span style={{ width: 40 }} />}
          <span className="center">审稿编辑部</span>
          <button className="act" onClick={onReload}>刷新</button>
        </div>
        <div className="large"><span className="eb">— Editor · 审 稿 —</span>待审稿件</div>
      </div>
      <Toast msg={msg} />
      <div className="countbar">
        <span className="n">Pending · {subs.length} 篇待审</span>
      </div>
      <div className="scroll">
        {subs.length === 0 && (
          <div className="empty"><div className="ico">✓</div><div className="t">全部处理完毕</div><div className="s">暂无待审稿件。</div></div>
        )}
        <div className="list">
          {subs.map((s) => (
            <div key={s.book_id} className="srow" onClick={() => onOpen(s.book_id)}>
              <div className={'thumb' + (s.cover ? '' : ' empty')}>
                {s.cover?.url && <img src={s.cover.url} alt="" />}
              </div>
              <div className="mid">
                <div className="t">《{s.title}》</div>
                <div className="by">{s.author}</div>
                <div className="tags">
                  <span className="chip">ID · {s.book_id}</span>
                  <span className="chip stat">待审</span>
                  <span className="chip src">{s.tag_source}</span>
                </div>
              </div>
              <span className="chev">›</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 详情：初审决定 → 收稿后配图打标 ──
function DetailScreen({ sub, core, onBack, onApprove, onReject, onRevise }) {
  const [stage, setStage] = useState('review'); // review | reject | revise | process
  const [reading, setReading] = useState(false);
  const [reason, setReason] = useState('');
  const [revision, setRevision] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const t = sub.tags;
  const c = sub.cover;

  const toggleTag = (cat, val) => {
    const cur = t[cat];
    const next = cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val];
    core.change({ ...sub, tags: { ...t, [cat]: next } });
  };
  const setField = (k, v) => core.change({ ...sub, tags: { ...t, [k]: v } });
  const setCover = (k, v) => core.change({ ...sub, cover: { ...sub.cover, [k]: v } });

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

  // 提交成功后由上层切回列表；失败则留在原阶段，仅解除 busy。
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    await fn();
    setBusy(false);
  };

  // 顶部标题随阶段变化
  const stageName = stage === 'process' ? '配图 · 打标' : stage === 'reject' ? '拒稿说明' : stage === 'revise' ? '修改意见' : '初审';

  const ManuscriptBlock = (
    <div className="grp">
      <div className="grp-h"><span className="gt">稿件内容</span><span className="gk">Manuscript</span></div>
      <div className="fl"><div className="k">扉页语 / 卷首短句</div><div className="v serif">{sub.intro}</div></div>
      <div className="fl"><div className="k">内容简介 / 故事概览</div><div className="v">{sub.sample}</div></div>
      <button className="btn ghost sm" style={{ marginTop: 4 }} onClick={() => setReading(true)}>阅读全文 ›</button>
    </div>
  );

  // ── 阅读页（编辑即读者）──
  if (reading) {
    const paras = (sub.full_content || '（暂无全文）').split(/\n+/).filter(Boolean);
    return (
      <div className="app slide-in" key={'read' + sub.book_id}>
        <div className="nav compact">
          <div className="row">
            <button className="back" onClick={() => setReading(false)}><span className="chev">‹</span>返回审稿</button>
            <span className="center">阅读</span>
            <span style={{ width: 40 }} />
          </div>
        </div>
        <div className="scroll">
          <div className="reader">
            <div className="r-meta">Manuscript · 全文</div>
            <h1>《{sub.title}》</h1>
            <div className="r-by">{sub.author}</div>
            <div className="r-epi">{sub.intro}</div>
            <div className="r-rule" />
            <div className="r-body">
              {paras.map((p, i) => <p key={i}>{p}</p>)}
            </div>
            <div className="r-end">· 全文完 ·</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app slide-in" key={'d' + sub.book_id + stage}>
      <div className="nav compact">
        <div className="row">
          <button className="back" onClick={stage === 'review' ? onBack : () => setStage('review')}>
            <span className="chev">‹</span>{stage === 'review' ? '待审' : '初审'}
          </button>
          <span className="center">{stageName} · {sub.book_id}</span>
          <span style={{ width: 40 }} />
        </div>
        <div className="large" style={{ fontSize: 24, paddingBottom: 12 }}>《{sub.title}》</div>
      </div>

      {/* 落地补充：终态动作失败时留在本页，用原型的 toast.err 回报原因（原型无失败路径）。 */}
      {core.msg?.kind === 'err' && <Toast msg={core.msg} />}

      <div className="scroll">
        <div className="pad">
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 16 }}>
            {sub.author} · ID {sub.book_id} · 标签源 {sub.tag_source}
          </div>

          {/* ── 阶段一：初审（读稿 + 决定）── */}
          {stage === 'review' && (
            <>
              {ManuscriptBlock}
              <div className="grp" style={{ background: 'var(--panel-2)' }}>
                <div className="grp-h"><span className="gt">初审决定</span><span className="gk">Decision</span></div>
                <p className="grp-hint">先判断这篇是否合格。合格则收稿，进入配图打标；否则退回修改或拒稿。</p>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.7 }}>
                  收稿后，稿件确认进入编辑流程，可继续配图与定标签，最终入推荐池。
                </div>
              </div>
            </>
          )}

          {/* ── 拒稿 ── */}
          {stage === 'reject' && (
            <div className="grp">
              <div className="grp-h"><span className="gt">拒稿说明</span><span className="gk">Reject</span></div>
              <p className="grp-hint">请写明拒稿理由，将随结果回给作者。</p>
              <textarea className="inp" value={reason} placeholder="例如：题材与本刊方向不符；结构尚不完整，建议大幅修改后再投。"
                style={{ minHeight: 120 }} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}

          {/* ── 修改意见 ── */}
          {stage === 'revise' && (
            <div className="grp">
              <div className="grp-h"><span className="gt">修改意见</span><span className="gk">Revision</span></div>
              <p className="grp-hint">退回作者修改，稿件保留待其再次提交。</p>
              <textarea className="inp" value={revision} placeholder="例如：故事尾声略仓促，可考虑展开林夏在车站的那段。"
                style={{ minHeight: 120 }} onChange={(e) => setRevision(e.target.value)} />
            </div>
          )}

          {/* ── 阶段二：收稿后 · 配图 + 标签 ── */}
          {stage === 'process' && (
            <>
              <div className="toast ok" style={{ margin: '0 0 16px' }}><span className="d" />已收稿 · 本篇通过初审，继续配图与定标签。</div>
              <div className="grp">
                <div className="grp-h"><span className="gt">编辑配图</span><span className="gk">Cover</span></div>
                <p className="grp-hint">由编辑部统一处理。仅用于前台展示，不参与 AI 分析。JPEG / PNG / WebP，最大 5MB。</p>
                {!c && (
                  <div className="cover-empty">
                    <div className="h">尚未配图</div>
                    <button className="btn ghost sm" onClick={pick} disabled={uploading} style={{ margin: '0 auto' }}>
                      {uploading ? '上传中…' : '上传文章图片'}
                    </button>
                  </div>
                )}
                {c && (
                  <>
                    <div className="cover-lg">
                      <span className="tag">Cover</span>
                      {c.url && <img src={c.url} alt={`${sub.title} 配图`} />}
                    </div>
                    <div className="fl"><div className="k">摄影师 / 图片作者姓名</div>
                      <input className="inp" value={c.photographer} placeholder="例如：摄影 / 林夏" onChange={(e) => setCover('photographer', e.target.value)} /></div>
                    <div className="fl"><div className="k">图片下方一句话说明</div>
                      <textarea className="inp" value={c.caption} placeholder="例如：风从旧街尽头吹来，像一封迟到的信。" onChange={(e) => setCover('caption', e.target.value)} /></div>
                    <div className="cover-url">{c.url}</div>
                    <div className="cover-actions">
                      <button className="linkbtn" onClick={pick} disabled={uploading}>{uploading ? '上传中…' : '重新选择图片'}</button>
                      <button className="linkbtn danger" onClick={() => core.change({ ...sub, cover: null })} disabled={uploading}>移除</button>
                    </div>
                  </>
                )}
                {err && <div className="toast err" style={{ margin: '10px 0 0' }}><span className="d" />{err}</div>}
                <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
              </div>

              <div className="grp">
                <div className="grp-h"><span className="gt">AI 标签确认与修改</span><span className="gk">Tags</span></div>
                <p className="grp-hint">三组核心标签为固定词表；美学与风险为自由文本（逗号分隔）。</p>
                {Object.keys(FIXED_TAGS).map((cat) => (
                  <div key={cat} className="tg">
                    <div className="tk">{FIXED_TAGS[cat].k}<span className="en">{FIXED_TAGS[cat].en}</span></div>
                    <div className="tset">
                      {FIXED_TAGS[cat].opts.map((o) => (
                        <span key={o} className={'tag' + (t[cat].includes(o) ? ' on' : '')} onClick={() => toggleTag(cat, o)}>{o}</span>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="row2" style={{ marginTop: 4 }}>
                  <div className="fl"><div className="k">美学标签（逗号分隔）</div>
                    <input className="inp" value={t.aesthetic} placeholder="电影感, 旧胶片" onChange={(e) => setField('aesthetic', e.target.value)} /></div>
                  <div className="fl"><div className="k">风险提示（逗号分隔）</div>
                    <input className="inp" value={t.risk} placeholder="轻微虐" onChange={(e) => setField('risk', e.target.value)} /></div>
                </div>
                <div className="fl" style={{ marginBottom: 0 }}><div className="k">编辑推荐理由</div>
                  <textarea className="inp" value={t.reason} placeholder="一句话，告诉读者这篇好在哪里。" onChange={(e) => setField('reason', e.target.value)} /></div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 底部操作条随阶段变化 */}
      <div className="actionbar">
        {stage === 'review' && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn ghost" style={{ flex: '0 0 auto', color: 'var(--danger)', background: 'transparent' }} onClick={() => setStage('reject')}>拒稿</button>
            <button className="btn ghost" style={{ flex: 1 }} onClick={() => setStage('revise')}>修改意见</button>
            <button className="btn" style={{ flex: 1.4 }} onClick={() => setStage('process')}>通过初审 · 收稿 →</button>
          </div>
        )}
        {stage === 'reject' && (
          <button className="btn" style={{ background: 'var(--danger)' }} disabled={busy || !reason.trim()}
            onClick={() => run(() => onReject(sub, reason))}>
            {busy ? '提交中…' : '确认拒稿并回复作者'}
          </button>
        )}
        {stage === 'revise' && (
          <button className="btn" disabled={busy || !revision.trim()}
            onClick={() => run(() => onRevise(sub, revision))}>
            {busy ? '提交中…' : '提交修改意见 · 退回作者'}
          </button>
        )}
        {stage === 'process' && (
          <>
            {!c && <div className="hint">尚未配图 · 可跳过直接发布</div>}
            <button className="btn approve" disabled={busy} onClick={() => run(() => onApprove(sub))}>
              {busy ? '发布中…' : '✓ 确认发布，入推荐池'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function EditorMobile({ core, onExit }) {
  // 已登录（core.token 存在）则直接进列表，否则从欢迎页开始。
  const [view, setView] = useState(core.token ? 'list' : 'welcome');
  const [openId, setOpenId] = useState(null);

  const doLogin = async (acct, pw) => {
    const ok = await core.login(acct, pw);
    if (ok) setView('list');
    return ok;
  };
  const openDetail = (id) => { setOpenId(id); core.setMsg(null); setView('detail'); };
  // 三个终态动作成功后一律回列表（稿件已移出），失败则留在详情页显示错误。
  const approve = async (sub) => { if (await core.approve(sub)) setView('list'); };
  const reject = async (sub, reason) => { if (await core.reject(sub, reason)) setView('list'); };
  const revise = async (sub, note) => { if (await core.revise(sub, note)) setView('list'); };

  const cur = core.subs.find((s) => s.book_id === openId);
  let screen;
  if (view === 'welcome') screen = <WelcomeScreen onEnter={() => { core.setMsg(null); setView('login'); }} />;
  else if (view === 'login') screen = <LoginScreen onBack={() => setView('welcome')} onLogin={doLogin} msg={core.msg} />;
  else if (view === 'detail' && cur) screen = <DetailScreen sub={cur} core={core} onBack={() => setView('list')} onApprove={approve} onReject={reject} onRevise={revise} />;
  else screen = <ListScreen subs={core.subs} msg={core.msg} onReload={core.reload} onOpen={openDetail} onExit={onExit} />;

  return <div className="ecx-ios">{screen}</div>;
}
