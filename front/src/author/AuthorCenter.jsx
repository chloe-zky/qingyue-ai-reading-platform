// AuthorCenter.jsx — 作者中心（进入页 → 我的稿件 → 投稿四步 → 递交中 → 双联回执；
// 以及查询入口 + 三态结果）。屏幕结构逐字移植自原型 screens-*.jsx，
// 路由/状态移植自 prototype/app.jsx（去掉评审外壳、IOSDevice、jumper、登录/注册遗留屏）。
//
// 集成：由 MineTab「作者中心」行以全屏浮层(.acx-overlay)打开；landing 返回「我的」= onExit。
// 数据为前端对接：递交为原型同款三段可见反馈 + 编号逐字符 reveal（真实后端接入见 submit()）。

import { useCallback, useState, useEffect } from 'react';
import { apiFetch } from '../lib/apiClient';
import { FlyingBirds } from './decor';
import {
  TopNav, BackBtn, RightLink, ProgressDots, Field, TextField, AreaField,
  GentleNote, BtnPrimary, BtnGhost, SegCtrl, SectionH, StepHead,
  Seal, Masthead, LedgerRow, Perforation, Trace, StagesFeedback, DraftFootnote,
  FileDrop,
} from './ui';
import './author.css';

const emptyForm = () => ({
  title: '', author: '',
  intro: '', sample: '',
  bodyMode: 'write', body: '',
  attachment: null,
  revisionReference: '',
});

const DRAFT_KEY = 'author_draft_v1';
const RECEIPTS_KEY = 'author_secure_receipts_v1';
const loadReceipts = () => {
  try {
    const value = JSON.parse(localStorage.getItem(RECEIPTS_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, 50) : [];
  } catch { return []; }
};
const rememberReceipt = (reference) => {
  if (!reference) return;
  try {
    const next = [reference, ...loadReceipts().filter((item) => item !== reference)].slice(0, 50);
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
};
const loadDraft = () => {
  try {
    const s = localStorage.getItem(DRAFT_KEY);
    const draft = s ? JSON.parse(s) : null;
    // 浏览器刷新后无法恢复 File 对象，上传模式必须重新选择原稿。
    return draft ? { ...emptyForm(), ...draft, attachment: null } : null;
  }
  catch { return null; }
};
const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const displayDate = (value) => {
  if (!value) return '已递交';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '已递交';
  return `${String(d.getMonth() + 1).padStart(2, '0')}·${String(d.getDate()).padStart(2, '0')}`;
};

const displayDateTime = (value) => {
  const d = value ? new Date(value) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  return `${safe.getFullYear()} · ${String(safe.getMonth() + 1).padStart(2, '0')} · ${String(safe.getDate()).padStart(2, '0')}   ${String(safe.getHours()).padStart(2, '0')}:${String(safe.getMinutes()).padStart(2, '0')}:${String(safe.getSeconds()).padStart(2, '0')}`;
};

const manuscriptView = (article) => ({
  ...article,
  id: article.reference_code,
  status: article.display_status === 'rejected'
    ? 'rej'
    : article.display_status === 'revision_requested'
      ? 'rev'
      : article.display_status,
  time: `${displayDate(article.submitted_at)} ${
    article.display_status === 'active'
      ? '通过'
      : article.display_status === 'rejected'
        ? '未通过'
        : article.display_status === 'revision_requested'
          ? '待修改'
          : '待审'
  }`,
});

// ═══════════ 进入页 Landing（原型 screens-auth.jsx · ScreenLanding） ═══════════
function ScreenLanding({ onEnter, onBack }) {
  return (
    <div className="app fade-in" key="landing">
      <TopNav brand="作者中心"
              left={<BackBtn onClick={onBack} label="我的" />}
              right={<span style={{ width: 30, display: 'inline-block' }} />} />
      <div className="landing" onClick={onEnter}>
        <FlyingBirds size={54} color="var(--ink-4)" style={{ position: 'absolute', top: 62, right: 30 }} />
        <div className="illu">
          {/* 开发者预置的固定封面图占位（220×260），实现时替换为静态资源 */}
          <div style={{
            width: 220, height: 260, border: '1px solid var(--rule)',
            background: 'var(--paper-soft)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: 'var(--ink-4)', fontSize: 12,
            letterSpacing: '0.04em', textAlign: 'center', padding: 20, lineHeight: 1.7,
          }}>
            固定封面图<br />（开发者放入）
          </div>
        </div>

        <div className="ctas">
          <h1>请把作品<br/>递到这里。</h1>
          <p className="tag">
            这是一个安静的投稿入口。<br/>
            您写下的，会由编辑当值阅读，<br/>
            而非进入一段算法。
          </p>

          <div className="enter-hint">
            <span className="mk">·</span> 轻触任意处，进入作者中心
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════ 我的稿件 Home（原型 screens-home.jsx · ScreenHome） ═══════════
function ScreenHome({ user, manuscripts, loading, error, onRefresh, onStartNew, onQuery, onOpenItem, onLogout }) {
  return (
    <div className="app fade-in" key="home">
      <TopNav
        brand="编辑部"
        left={<RightLink onClick={onQuery}>查询</RightLink>}
        right={<RightLink onClick={onLogout}>切换</RightLink>}
      />
      <div className="scroll">
        <div className="page" style={{ paddingTop: 14 }}>
          <h2 style={{ marginBottom: 4 }}>{user.name}，您回来了。</h2>
          <p className="sub">愿这一次的递交顺利。</p>

          <div className="new-card" onClick={onStartNew}>
            <span className="arrow">→</span>
            <div className="ttl">开始一次新的递交</div>
            <div className="desc">署名 · 引子 · 正文与附件 · 递交，四步。<br/>大约需要 8–15 分钟。</div>
          </div>

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            paddingBottom: 8, borderBottom: '1px solid var(--rule)',
          }}>
            <SectionH ko="Manuscripts">我的稿件</SectionH>
            <span style={{ fontFamily: 'var(--num)', fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.08em' }}>
              {manuscripts.length} 篇
            </span>
          </div>

          <div className="item-list">
            {manuscripts.map((m) => (
              <div key={m.book_id} className="item" onClick={() => onOpenItem(m)}>
                <div>
                  <div className="t1">《{m.title}》</div>
                  <div className="t2">{m.id}</div>
                </div>
                <div className="right">
                  <div className={'st ' + m.status}>
                    <span className="d" />
                    {m.status === 'pending' && '待审读'}
                    {m.status === 'active' && '已通过'}
                    {m.status === 'rej' && '暂未通过'}
                    {m.status === 'rev' && '请修改'}
                  </div>
                  <div className="time">{m.time}</div>
                </div>
              </div>
            ))}
            {!loading && !error && manuscripts.length === 0 && (
              <div style={{ padding: '30px 4px', color: 'var(--ink-3)', fontSize: 13, lineHeight: 1.8 }}>
                还没有递交过作品。<br/>第一份稿件，会从这里开始留下记录。
              </div>
            )}
          </div>

          <div style={{ height: 24 }} />
          {loading && <GentleNote>正在从编辑部取回稿件记录……</GentleNote>}
          {error && (
            <GentleNote accent>
              <span className="h">暂时没取到稿件</span>
              {error}<br/>
              <button className="right-link" onClick={onRefresh} style={{ marginTop: 8 }}>再试一次</button>
            </GentleNote>
          )}
          <GentleNote>
            尚未投出去的草稿会自动留在本机。<br/>
            已递交稿件凭本机保存的安全回执从编辑部实时取回。
          </GentleNote>
        </div>
      </div>
    </div>
  );
}

// ═══════════ Step 1 · 署名 ═══════════
function ScreenStep1({ form, setForm, onNext, onBack, savedAt }) {
  const can = form.title.trim() && form.author.trim();
  return (
    <div className="app fade-in" key="s1">
      <TopNav brand="投稿" left={<BackBtn onClick={onBack} label="回首页" />} right={<RightLink onClick={onBack}>暂存</RightLink>} />
      <div className="scroll">
        <ProgressDots step={1} total={4} />
        <StepHead n={1} roman="Byline · 署名" title="署 名" sub="给这部稿件起个名字。" />
        <div className="page" style={{ paddingTop: 4 }}>
          <TextField label="Title · 文章标题" placeholder="如：林夏的冬天"
                     value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
          <TextField label="Author · 作者 / 笔名" hint="编辑回信会用这个名字" placeholder="您的笔名"
                     value={form.author} onChange={(v) => setForm({ ...form, author: v })} />
          <div style={{ height: 28 }} />
          <BtnPrimary onClick={onNext} disabled={!can}>继 续</BtnPrimary>
          <p className="next-help">i / iv</p>
        </div>
      </div>
      <DraftFootnote time={savedAt} />
    </div>
  );
}

// ═══════════ Step 2 · 引子 ═══════════
function ScreenStep2({ form, setForm, onNext, onBack, savedAt }) {
  const can = form.intro.trim() && form.sample.trim();
  return (
    <div className="app fade-in" key="s2">
      <TopNav brand="投稿" left={<BackBtn onClick={onBack} />} right={<RightLink onClick={onBack}>暂存</RightLink>} />
      <div className="scroll">
        <ProgressDots step={2} total={4} />
        <StepHead n={2} roman="Preface · 引子" title="引 子" sub="写一句开篇，再讲一段故事大概。" />
        <div className="page" style={{ paddingTop: 4 }}>
          <AreaField label="Epigraph · 扉页语 / 卷首短句" hint="一两句即可" short
                     placeholder="例：林夏后来才知道，自己错过的是一整个冬天。"
                     value={form.intro} onChange={(v) => setForm({ ...form, intro: v })} />
          <AreaField label="Synopsis · 内容简介" hint="给编辑与系统看"
                     placeholder={"背景、人物、情绪基调与主要情节。\n约 200–400 字。"}
                     value={form.sample} onChange={(v) => setForm({ ...form, sample: v })} />
          <GentleNote accent>
            <span className="h">关于这两段文字 · 边界</span>
            它们会和编辑一起读到，<br/>
            也会帮系统理解这部作品。
          </GentleNote>
          <BtnPrimary onClick={onNext} disabled={!can}>继 续</BtnPrimary>
          <p className="next-help">ii / iv</p>
        </div>
      </div>
      <DraftFootnote time={savedAt} />
    </div>
  );
}

// ═══════════ Step 3 · 正文 + 附件 + 封面 ═══════════
function ScreenStep3({ form, setForm, onChooseDocument, documentError, onNext, onBack, savedAt }) {
  const mode = form.bodyMode || 'write';
  const setMode = (m) => setForm({ ...form, bodyMode: m });
  const [fileError, setFileError] = useState('');

  const can = (mode === 'write' && form.body.trim().length > 20)
           || (mode === 'upload' && form.attachment && form.attachment.progress >= 1);

  return (
    <div className="app fade-in" key="s3">
      <TopNav brand="投稿" left={<BackBtn onClick={onBack} />} right={<RightLink onClick={onBack}>暂存</RightLink>} />
      <div className="scroll">
        <ProgressDots step={3} total={4} />
        <StepHead n={3} roman="Manuscript · 正文" title="正文 · 原稿" sub="把全文交付。短篇可在此撰写，长篇可上传 DOCX。" />
        <div className="page" style={{ paddingTop: 4 }}>
          <SectionH ko="Manuscript">正 文</SectionH>
          <SegCtrl value={mode} onChange={setMode}
                   options={[{ value: 'write', label: '在此撰写' }, { value: 'upload', label: '上传 Word 文档' }]} />

          {mode === 'write' && (
            <>
              <AreaField label=""
                         placeholder={"那年冬天，林夏在北方的第三个城市里第一次听见暖气片的嗡鸣……"}
                         value={form.body} onChange={(v) => setForm({ ...form, body: v })} />
              <div style={{
                marginTop: -16, marginBottom: 22, display: 'flex', justifyContent: 'space-between',
                fontFamily: 'var(--num)', fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.08em',
              }}>
                <span>{form.body.replace(/\s/g, '').length} 字</span>
                <span>约 {Math.max(1, Math.round(form.body.length / 240))} 分钟阅读</span>
              </div>
            </>
          )}

          {mode === 'upload' && (
            <>
              <FileDrop
                file={form.attachment}
                onChoose={onChooseDocument}
                onRemove={() => setForm({ ...form, attachment: null })}
                onError={setFileError}
                tag="Manuscript · 原稿文件"
                hint={<>轻点选择一份 <span className="em">DOCX 文档</span>。<br/>系统会即时读取文字，原文件不会保存。</>}
              />
              {(fileError || documentError) && <p className="section-sub" style={{ color: 'var(--accent)', marginTop: 8 }}>{fileError || documentError}</p>}
              <div style={{ height: 18 }} />
            </>
          )}

          <div style={{ height: 18 }} />
          <GentleNote>
            <span className="h">关于这一步 · 边界</span>
            正文不会被默认进入 AI 分析。<br/>
            DOCX 只即时提取文字，不保存原文件。<br/>
            作品配图由编辑部在审稿阶段统一处理。
          </GentleNote>

          <BtnPrimary onClick={onNext} disabled={!can}>继 续</BtnPrimary>
          <p className="next-help">iii / iv</p>
        </div>
      </div>
      <DraftFootnote time={savedAt} />
    </div>
  );
}

// ═══════════ Step 4 · 递交 ═══════════
function ScreenStep4({ form, submitting, submitError, onSubmit, onBack, savedAt }) {
  const writeLen = form.body.replace(/\s/g, '').length;
  const charCount = form.bodyMode === 'upload'
    ? '附件 · ' + (form.attachment ? form.attachment.size : '—')
    : writeLen.toLocaleString() + ' 字';
  const readMin = form.bodyMode === 'upload'
    ? '估按附件长度'
    : '约 ' + Math.max(1, Math.round(writeLen / 240)) + ' 分钟阅读';

  return (
    <div className="app fade-in" key="s4">
      <TopNav brand="投稿" left={<BackBtn onClick={onBack} />} right={<RightLink onClick={onBack}>暂存</RightLink>} />
      <div className="scroll">
        <ProgressDots step={4} total={4} />
        <StepHead n={4} roman="Dispatch · 递交" title="递 交" sub="读一遍，递出去。" />
        <div className="page" style={{ paddingTop: 4 }}>
          <Masthead title="即将递交至 · 编辑部" refCode="No. 待生成" />

          <div className="ledger">
            <LedgerRow k="Title"><strong>《{form.title || '—'}》</strong></LedgerRow>
            <LedgerRow k="Author">{form.author || '—'}</LedgerRow>
            <LedgerRow k="Epigraph">
              <span style={{ color: 'var(--ink-2)', fontSize: 12.5 }}>{form.intro.slice(0, 30) || '—'}{form.intro.length > 30 && '……'}</span>
            </LedgerRow>
            <LedgerRow k="Synopsis">
              <span style={{ color: 'var(--ink-2)', fontSize: 12.5 }}>{form.sample.slice(0, 36) || '—'}{form.sample.length > 36 && '……'}</span>
            </LedgerRow>
            <LedgerRow k="Body"><span className="num">{charCount} · {readMin}</span></LedgerRow>
            {form.attachment && (
              <LedgerRow k="File">
                <span>{form.attachment.name} <span style={{ color: 'var(--ink-4)', fontSize: 11 }}>· {form.attachment.size}</span></span>
              </LedgerRow>
            )}
            <LedgerRow k="Cover">由编辑部统一配置</LedgerRow>
          </div>

          <div style={{ height: 18 }} />

          <GentleNote accent>
            <span className="h">关于这次递交</span>
            您的扉页语与内容简介会用于辅助编辑与系统理解作品；<br/>
            正文与附件不会默认进入 AI 分析；<br/>
            稿件递交后，将由编辑当值审读，<br/>
            结果通常在三日内回复。
          </GentleNote>

          {submitError && (
            <GentleNote accent>
              <span className="h">这次没有递交成功</span>
              {submitError}
            </GentleNote>
          )}

          <div className="btn-row" style={{ marginBottom: 14 }}>
            <BtnGhost onClick={onBack}>再读一遍</BtnGhost>
            <BtnPrimary onClick={onSubmit} disabled={submitting}>{submitting ? '正在递交…' : '递 交'}</BtnPrimary>
          </div>

          <p className="next-help" style={{ marginTop: 6 }}>点击「递交」即视为知悉以上边界。</p>
        </div>
      </div>
      <DraftFootnote time={savedAt} />
    </div>
  );
}

// ═══════════ Submitting · 三阶段反馈（编号逐字符 reveal） ═══════════
function ScreenSubmitting({ form, bookId, onArrive }) {
  const [stage, setStage] = useState(0);
  const [revealed, setRevealed] = useState('');
  // 展示编号用 · 分段（复制用 - 分段，见 Receipt）
  const fullCode = bookId.replace(/-/g, ' · ');

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 600);
    const t2 = setTimeout(() => setStage(2), 1200);
    const t3 = setTimeout(() => {
      let i = 0;
      const id = setInterval(() => {
        i++;
        setRevealed(fullCode.slice(0, i));
        if (i >= fullCode.length) { clearInterval(id); setTimeout(onArrive, 500); }
      }, 55);
    }, 1300);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [fullCode, onArrive]);

  const stages = [
    { state: stage === 0 ? 'now' : 'done', label: stage === 0 ? '正在装订稿件……' : '已装订成稿' },
    { state: stage < 1 ? 'wait' : stage === 1 ? 'now' : 'done', label: stage < 1 ? '送达编辑部' : stage === 1 ? '送达编辑部……' : '已送达编辑部' },
    { state: stage < 2 ? 'wait' : 'now', label: stage < 2 ? '生成稿件编号' : '编号已生成', code: stage >= 2 ? revealed : null },
  ];

  return (
    <div className="app fade-in" key="sub">
      <TopNav brand="投稿"
              left={<span style={{ display: 'inline-block', width: 30 }} />}
              right={<span style={{ color: 'var(--ink-3)', fontSize: 12 }}>递交中…</span>} />
      <div className="scroll">
        <div className="page" style={{ paddingTop: 8 }}>
          <h2>正在递交</h2>
          <p className="sub">请稍候，这一刻不长。</p>
          <StagesFeedback stages={stages} />
          <div style={{ marginTop: 28, paddingTop: 18, borderTop: '1px solid var(--rule)' }}>
            <div style={{ fontFamily: 'var(--num)', fontSize: 10.5, letterSpacing: '0.18em', color: 'var(--ink-4)', textTransform: 'uppercase', marginBottom: 10 }}>
              本次递交
            </div>
            <div style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 16, marginBottom: 6 }}>《{form.title || '林夏的冬天'}》</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
              {form.author || '江南'} · {form.bodyMode === 'upload' ? (form.attachment && form.attachment.size) : (form.body.replace(/\s/g, '').length.toLocaleString() + ' 字')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════ Receipt · 双联存执 ═══════════
function ScreenReceipt({ form, submission, onHome, onQuery }) {
  const [copied, setCopied] = useState(false);
  const bookId = submission.reference_code;
  const submittedAt = displayDateTime(submission.submitted_at);
  const copy = () => {
    try { navigator.clipboard && navigator.clipboard.writeText(bookId); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="app fade-in" key="rc">
      <TopNav brand="编辑部" left={<BackBtn onClick={onHome} label="首页" />} right={<RightLink onClick={onQuery}>查询</RightLink>} />
      <div className="scroll">
        <div className="page" style={{ paddingTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 24 }}>作品已递交</h2>
              <p className="sub" style={{ margin: '6px 0 0' }}>编辑部当值已签收，正在等待审读。</p>
            </div>
            <Seal>已 收<br/>編 輯 部</Seal>
          </div>

          <div style={{ height: 16 }} />

          <Masthead title="编辑部 · 投稿存执" refCode={'No. ' + bookId} />

          <div className="ledger">
            <LedgerRow k="Title"><strong>《{form.title || '林夏的冬天'}》</strong></LedgerRow>
            <LedgerRow k="Author">{form.author || '江南'}</LedgerRow>
            <LedgerRow k="Length">
              <span className="num">
                {form.bodyMode === 'upload'
                  ? (form.attachment ? form.attachment.name + ' · ' + form.attachment.size : '—')
                  : (form.body.replace(/\s/g, '').length.toLocaleString() + ' 字 · 约 ' + Math.max(1, Math.round(form.body.length / 240)) + ' 分钟')}
              </span>
            </LedgerRow>
            <LedgerRow k="Cover">由编辑部统一配置</LedgerRow>
            <LedgerRow k="Sent"><span className="num">{submittedAt}</span></LedgerRow>
            <LedgerRow k="Recv"><span className="num">{submittedAt} · 已入库</span></LedgerRow>
            <LedgerRow k="Status" isStat statKind="pend">待审读 · 通常三日内回复</LedgerRow>
          </div>

          {submission.warning && (
            <GentleNote accent>
              <span className="h">编辑部提示</span>
              {submission.warning}
            </GentleNote>
          )}

          <Perforation />

          <div style={{ fontFamily: 'var(--num)', fontSize: 10, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 10 }}>
            Author's Copy · 作者留存
          </div>
          <div style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 15.5, marginBottom: 4 }}>
            《{form.title || '林夏的冬天'}》 · {form.author || '江南'}
          </div>
          <div style={{ fontFamily: 'var(--num)', fontSize: 12, color: 'var(--ink-2)', letterSpacing: '0.06em' }}>
            {bookId}
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '8px 0 22px', lineHeight: 1.7 }}>
            这是包含私密凭证的完整安全编号，请勿公开分享；凭此可查询和递交修订稿。
          </p>

          <div className="btn-row" style={{ marginBottom: 10 }}>
            <BtnGhost thin onClick={copy}>{copied ? '已复制' : '复制编号'}</BtnGhost>
            <BtnGhost thin onClick={onQuery}>查询进展</BtnGhost>
          </div>
          <BtnPrimary onClick={onHome}>回到首页</BtnPrimary>

          <div style={{ height: 28 }} />
        </div>
      </div>
    </div>
  );
}

// ═══════════ 查询入口 ═══════════
function ScreenQueryEntry({ querying, error, onBack, onQuery }) {
  const [code, setCode] = useState('');
  return (
    <div className="app fade-in" key="q0">
      <TopNav brand="查询" left={<BackBtn onClick={onBack} label="返回" />} right={<span style={{ width: 30, display: 'inline-block' }} />} />
      <div className="scroll">
        <div className="page" style={{ paddingTop: 14 }}>
          <h2>查 询</h2>
          <p className="sub">粘贴回执上的完整安全编号，看看进展。</p>
          <Field label="No. · 稿件编号" hint="不区分大小写">
            <input className="val" placeholder="例如：BR-128-安全凭证" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <div style={{ height: 10 }} />
          {error && <GentleNote accent>{error}</GentleNote>}
          <BtnPrimary disabled={querying || !code.trim()} onClick={() => onQuery(code.trim())}>{querying ? '正在查阅…' : '查 阅'}</BtnPrimary>
          <p className="next-help">编辑通常在三日内回复。</p>
        </div>
      </div>
    </div>
  );
}

function statusMeta(status) {
  if (status === 'pending') return { title: '正在等待审读。', color: 'var(--ink)', note: '编辑通常在三日内回复。' };
  if (status === 'active') return { title: '已通过审读。', color: 'var(--accent)', note: '作品已进入推荐池。感谢您的递交。' };
  if (status === 'rev') return { title: '编辑希望您修改后再投。', color: 'var(--accent)', note: '请参考编辑留言完善稿件，再提交一份新稿。' };
  return { title: '暂未通过审读。', color: 'var(--ink)', note: '您可以修改后再次递交。' };
}

// ═══════════ 查询 · 三态结果 ═══════════
function ScreenQueryResult({ article, querying, queryError, onBack, onRetry, onResubmit }) {
  const status = article.display_status === 'rejected'
    ? 'rej'
    : article.display_status === 'revision_requested'
      ? 'rev'
      : article.display_status;
  const meta = statusMeta(status);
  const traceItems = [
    { state: 'done', time: displayDateTime(article.submitted_at), label: '作者递交 · 编辑部入库' },
  ];
  if (status === 'pending') {
    traceItems.push({ state: 'now', time: '— 等待中 —', label: '编辑审读' });
    traceItems.push({ state: 'pending', time: '—', label: '审读完成' });
  } else if (status === 'active') {
    traceItems.push({ state: 'done', time: '— 已完成 —', label: '审读通过 · 已进入推荐池' });
  } else if (status === 'rev') {
    traceItems.push({ state: 'done', time: '— 已回复 —', label: '编辑审读 · 请求修改' });
    traceItems.push({ state: 'now', time: '— 待作者 —', label: '修改后再次递交' });
  } else {
    traceItems.push({ state: 'done', time: '— 已完成 —', label: '审读完成 · 暂未通过' });
  }

  return (
    <div className="app fade-in" key={'q1-' + status}>
      <TopNav brand="查询" left={<BackBtn onClick={onBack} label="返回" />} right={<span style={{ width: 30, display: 'inline-block' }} />} />
      <div className="scroll">
        <div className="page" style={{ paddingTop: 10 }}>
          <h2 style={{ fontSize: 22 }}>《{article.title}》</h2>
          <p className="sub" style={{ marginBottom: 20 }}>
            <span style={{ color: meta.color }}>{meta.title}</span><br/>
            <span style={{ fontSize: 12.5 }}>{meta.note}</span>
          </p>

          <div style={{ fontFamily: 'var(--num)', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 10 }}>
            Processing Trace · 处理轨迹
          </div>
          <Trace items={traceItems} />

          {(status === 'rej' || status === 'rev') && article.editor_feedback && (
            <GentleNote head="编辑留言">
              {article.editor_feedback}
            </GentleNote>
          )}

          {queryError && <GentleNote accent>{queryError}</GentleNote>}

          <div className="draft-foot" style={{ margin: '22px -22px 0', borderTop: '1px dotted var(--rule)' }}>
            <span><span className="dot" />已刷新于 {nowHHMM()}</span>
            <span>{article.reference_code}</span>
          </div>

          <div style={{ height: 20 }} />
          {status === 'pending' && <BtnGhost onClick={onRetry}>{querying ? '查询中…' : '再查一次'}</BtnGhost>}
          {status === 'rej' && (
            <div className="btn-row">
              <BtnGhost onClick={onRetry}>{querying ? '查询中…' : '再查一次'}</BtnGhost>
              <BtnPrimary onClick={onResubmit}>再投一次</BtnPrimary>
            </div>
          )}
          {status === 'rev' && (
            <div className="btn-row">
              <BtnGhost onClick={onRetry}>{querying ? '查询中…' : '再查一次'}</BtnGhost>
              <BtnPrimary onClick={onResubmit}>修改后再投</BtnPrimary>
            </div>
          )}
          {status === 'active' && <BtnPrimary onClick={onRetry}>{querying ? '查询中…' : '再查一次'}</BtnPrimary>}
        </div>
      </div>
    </div>
  );
}

// ═══════════ 路由 + 状态（原型 app.jsx，去外壳） ═══════════
export default function AuthorCenter({ onExit, userName = '江南' }) {
  const [screen, setScreen] = useState('landing');
  const [savedAt, setSavedAt] = useState(nowHHMM());
  const [form, _setForm] = useState(() => loadDraft() || emptyForm());
  const [manuscripts, setManuscripts] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [documentError, setDocumentError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submission, setSubmission] = useState(null);
  const [queryArticle, setQueryArticle] = useState(null);
  const [querying, setQuerying] = useState(false);
  const [queryError, setQueryError] = useState('');
  const user = { name: userName };

  // setForm 包装：写入本地草稿（key: author_draft_v1），并更新脚注时间。
  const setForm = (next) => {
    const f = typeof next === 'function' ? next(form) : next;
    _setForm(f);
    setSavedAt(nowHHMM());
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...f, attachment: null }));
    } catch { /* ignore */ }
  };

  const go = (s) => setScreen(s);
  const startNew = () => {
    const f = { ...emptyForm(), author: userName };
    _setForm(f);
    setSubmission(null);
    setSubmitError('');
    setDocumentError('');
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(f)); } catch { /* ignore */ }
    go('s1');
  };

  const startRevision = (article) => {
    const f = {
      ...emptyForm(),
      title: article.title || '',
      author: article.author || userName,
      intro: article.intro || '',
      sample: article.sample || '',
      body: article.full_content || '',
      revisionReference: article.reference_code || '',
    };
    _setForm(f);
    setSubmission(null); setSubmitError(''); setDocumentError('');
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(f)); } catch { /* ignore */ }
    go('s1');
  };

  const loadManuscripts = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      const data = await apiFetch('/api/author/article-statuses', {
        method: 'POST',
        auth: false,
        body: { references: loadReceipts() },
      });
      setManuscripts((data.articles || []).map(manuscriptView));
    } catch (err) {
      setListError(err.message || '暂时无法读取稿件列表。');
    } finally {
      setListLoading(false);
    }
  }, []);

  const chooseDocument = async (fileInfo) => {
    setDocumentError('');
    setForm({ ...form, attachment: fileInfo });
    try {
      const body = new FormData();
      body.append('file', fileInfo.rawFile);
      const data = await apiFetch('/api/author/manuscript-text', {
        method: 'POST', auth: false, body,
      });
      setForm({
        ...form,
        bodyMode: 'upload',
        body: data.full_content,
        attachment: {
          name: fileInfo.name,
          size: fileInfo.size,
          progress: 1,
          characterCount: data.character_count,
        },
      });
    } catch (err) {
      setDocumentError(err.message || 'Word 文档读取失败。');
      setForm({ ...form, attachment: null });
    }
  };

  const submitArticle = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const payload = {
        title: form.title.trim(),
        author: form.author.trim(),
        intro: form.intro.trim(),
        sample: form.sample.trim(),
        full_content: form.body.trim(),
        revision_reference: form.revisionReference || undefined,
      };
      const data = await apiFetch('/api/author/articles', {
        method: 'POST',
        auth: false,
        body: payload,
      });
      rememberReceipt(data.reference_code);
      setSubmission({ ...data, submitted_at: new Date().toISOString() });
      go('submitting');
    } catch (err) {
      setSubmitError(err.message || '稿件递交失败，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  };

  const queryStatus = async (reference, navigate = true) => {
    if (!reference || querying) return;
    setQuerying(true);
    setQueryError('');
    try {
      const data = await apiFetch(
        `/api/author/articles/${encodeURIComponent(reference)}/status`,
        { auth: false },
      );
      rememberReceipt(data.reference_code);
      setQueryArticle(data);
      if (navigate) go('q1');
    } catch (err) {
      setQueryError(err.message || '暂时无法查询稿件。');
    } finally {
      setQuerying(false);
    }
  };

  const openManuscript = (manuscript) => {
    setQueryArticle(manuscript);
    go('q1');
    queryStatus(manuscript.reference_code, false);
  };

  // 递交成功进入回执：清空本地草稿（回执为终态，不可回退 Step 4）。
  const finishSubmit = useCallback(() => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    setScreen('receipt');
  }, []);

  let body;
  if (screen === 'landing') {
    body = <ScreenLanding onEnter={() => { loadManuscripts(); go('home'); }} onBack={onExit} />;
  } else if (screen === 'home') {
    body = (
      <ScreenHome user={user} manuscripts={manuscripts} loading={listLoading} error={listError}
        onRefresh={loadManuscripts}
        onStartNew={startNew}
        onQuery={() => go('q0')}
        onOpenItem={openManuscript}
        onLogout={() => go('landing')} />
    );
  } else if (screen === 's1') {
    body = <ScreenStep1 form={form} setForm={setForm} savedAt={savedAt} onNext={() => go('s2')} onBack={() => go('home')} />;
  } else if (screen === 's2') {
    body = <ScreenStep2 form={form} setForm={setForm} savedAt={savedAt} onNext={() => go('s3')} onBack={() => go('s1')} />;
  } else if (screen === 's3') {
    body = <ScreenStep3 form={form} setForm={setForm} onChooseDocument={chooseDocument} documentError={documentError} savedAt={savedAt} onNext={() => go('s4')} onBack={() => go('s2')} />;
  } else if (screen === 's4') {
    body = <ScreenStep4 form={form} submitting={submitting} submitError={submitError} savedAt={savedAt} onSubmit={submitArticle} onBack={() => go('s3')} />;
  } else if (screen === 'submitting') {
    body = <ScreenSubmitting form={form} bookId={submission.reference_code} onArrive={finishSubmit} />;
  } else if (screen === 'receipt') {
    body = <ScreenReceipt form={form} submission={submission} onHome={() => { loadManuscripts(); go('home'); }} onQuery={() => go('q0')} />;
  } else if (screen === 'q0') {
    body = <ScreenQueryEntry querying={querying} error={queryError} onBack={() => go('home')} onQuery={queryStatus} />;
  } else if (screen === 'q1' && queryArticle) {
    body = <ScreenQueryResult article={queryArticle} querying={querying} queryError={queryError} onBack={() => go('q0')} onRetry={() => queryStatus(queryArticle.reference_code, false)} onResubmit={() => startRevision(queryArticle)} />;
  }

  return (
    <div className="acx-overlay">
      <div className="acx">{body}</div>
    </div>
  );
}
