// editorial.jsx — 编辑部负责人工作台（内容策略 · 文艺纸感主题）
// DOM / 类名 / 文案 / 内联样式逐字移植自 prototype-admin/editorial.jsx。
//
// 概览、Prompt/策略列表、词表版本与审计日志已接真实后端只读接口。
// 尚未实现的草稿、发布、回滚、词条 CRUD 与模拟运行会明确提示，不伪造成功。

import { useCallback, useEffect, useState } from 'react';
import Icon from './shared/Icon';
import { PROMPT_STATUS } from './shared/constants';
import { staffApi, errorMessage, formatDateTime, toUiEditorialLog, toUiPrompt, toUiStrategy, versionLabel } from './api';
import { Spin, StatusBadge, VersionBadge, EmptyState, ErrorState, LoadingState } from './shared/ui';
import { UnsavedChangesDialog } from './shared/dialogs';

/* ── 1. 编辑策略概览 ── */
export function EditorialOverview({ ctx }) {
  const [o, setOverview] = useState(null);
  const [loadError, setLoadError] = useState('');
  const loadOverview = useCallback(async () => {
    setLoadError('');
    try { setOverview(await staffApi.editorialOverview()); }
    catch (error) { setLoadError(errorMessage(error, '编辑策略概览读取失败。')); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(loadOverview, 0);
    return () => clearTimeout(timer);
  }, [loadOverview]);

  if (!o && !loadError) return <div className="page fade-in"><LoadingState rows={4} /></div>;
  if (loadError) return <div className="page fade-in"><ErrorState desc={loadError} onRetry={loadOverview} /></div>;
  return (
    <div className="page fade-in">
      <div className="phead">
        <div><div className="eyebrow">— Editorial Overview —</div><h1>编辑策略概览</h1><p className="lead">Prompt、标签词表与推荐策略的当前生效状态。草稿在正式发布前不会影响线上审稿。</p></div>
      </div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="kpi"><div className="kk"><Icon id="prompt" size={14} />当前 Prompt 版本</div><div className="kv" style={{ fontSize: 26 }}>{versionLabel(o.prompt_version)}</div><div className="kmeta">{o.draft_count} 个待发布草稿</div></div>
        <div className="kpi"><div className="kk"><Icon id="tags" size={14} />当前标签词表</div><div className="kv" style={{ fontSize: 26 }}>{versionLabel(o.tag_vocabulary_version)}</div><div className="kmeta">最近发布 {formatDateTime(o.last_published_at)}</div></div>
        <div className="kpi"><div className="kk"><Icon id="reco" size={14} />当前推荐策略</div><div className="kv" style={{ fontSize: 26 }}>{versionLabel(o.strategy_version)}</div><div className="kmeta">AI 打标成功率尚无统计接口</div></div>
      </div>
      <div className="card">
        <div className="card-h"><div className="ct">最近策略变更</div><button className="btn ghost sm" onClick={() => ctx.go('editLogs')}>查看发布记录</button></div>
        <div className="banner info"><span className="bd" /><span className="bx">最近一次发布：<b>{formatDateTime(o.last_published_at)}</b>。详细变更请查看编辑配置日志。</span></div>
      </div>
      <div className="card">
        <div className="card-h"><div className="ct">常用操作</div></div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => ctx.go('prompt')}><Icon id="plus" size={14} className="btn-ico" />新建 Prompt</button>
          <button className="btn ghost" onClick={() => ctx.go('tags')}><Icon id="tags" size={14} className="btn-ico" />管理标签词表</button>
          <button className="btn ghost" onClick={() => ctx.go('reco')}><Icon id="reco" size={14} className="btn-ico" />调整推荐策略</button>
          <button className="btn ghost" onClick={() => ctx.go('sim')}><Icon id="sim" size={14} className="btn-ico" />运行策略模拟</button>
        </div>
      </div>
    </div>
  );
}

/* ── 2. Prompt 管理（列表 / 编辑 / 对比 / 历史抽屉）── */
export function PromptManager({ ctx }) {
  const [view, setView] = useState('list'); // list | editor | compare
  const [prompts, setPrompts] = useState([]);
  const [cur, setCur] = useState(null);
  const [history, setHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const loadPrompts = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { setPrompts((await staffApi.prompts()).map(toUiPrompt)); }
    catch (error) { setLoadError(errorMessage(error, 'Prompt 列表读取失败。')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(loadPrompts, 0);
    return () => clearTimeout(timer);
  }, [loadPrompts]);

  function openEditor(p) { setCur(p); setView('editor'); }
  async function publish(p) {
    ctx.push(`${p.name} 的发布接口尚未实现，未修改线上版本。`, 'info');
  }
  async function rollback(p) {
    ctx.push(`${p.name} 的回滚接口尚未实现，未修改线上版本。`, 'info');
  }

  if (view === 'editor') return <PromptEditor p={cur} ctx={ctx} onBack={() => setView('list')} onCompare={() => setView('compare')} />;
  if (view === 'compare') return <PromptVersionCompare p={cur} onBack={() => setView('editor')} />;

  return (
    <div className="page wide fade-in">
      <div className="phead">
        <div><div className="eyebrow">— Prompt Library —</div><h1>Prompt 管理</h1><p className="lead">管理各使用场景的提示词及其版本。草稿修改不会立即影响线上，只有发布后生效。</p></div>
        <div className="pactions"><button className="btn" onClick={() => openEditor({ id: 0, name: '', scene: '稿件内容分析', live: '—', draft: 'v1', status: 'draft' })}><Icon id="plus" size={14} className="btn-ico" />新建 Prompt</button></div>
      </div>
      <div className="card pad0">
        {loading && <LoadingState rows={4} />}
        {!loading && loadError && <ErrorState desc={loadError} onRetry={loadPrompts} />}
        {!loading && !loadError && prompts.length === 0 && <EmptyState title="暂无 Prompt" desc="数据库中尚未创建 Prompt 配置。" />}
        {!loading && !loadError && prompts.length > 0 &&
        <table className="tbl">
          <thead><tr><th>Prompt / 场景</th><th>生效版本</th><th>草稿</th><th>状态</th><th>最近修改</th><th style={{ textAlign: 'right' }}>操作</th></tr></thead>
          <tbody>
            {prompts.map((p) => (
              <tr key={p.id}>
                <td><div className="t-name">{p.name}</div><div className="t-sub">{p.scene}</div></td>
                <td><VersionBadge v={p.live} /></td>
                <td>{p.draft ? <VersionBadge v={p.draft} label="草稿" /> : <span className="muted">—</span>}</td>
                <td><StatusBadge kind={(PROMPT_STATUS[p.status] || PROMPT_STATUS.draft)[0]}>{(PROMPT_STATUS[p.status] || PROMPT_STATUS.draft)[1]}</StatusBadge></td>
                <td><div className="t-mono">{p.at}</div><div className="t-sub">{p.by}</div></td>
                <td><div className="t-actions">
                  <button className="rowbtn" onClick={() => openEditor(p)}>编辑草稿</button>
                  <button className="rowbtn" onClick={() => { setCur(p); setHistory(true); }}>历史</button>
                  {p.draft && <button className="rowbtn" onClick={() => publish(p)}>发布</button>}
                  {p.status === 'published' && <button className="rowbtn" onClick={() => rollback(p)}>回滚</button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
        }
      </div>
      {history && <VersionHistoryDrawer title={`${cur?.name} · 版本历史`} onClose={() => setHistory(false)} />}
    </div>
  );
}

export function PromptEditor({ p, ctx, onBack, onCompare }) {
  const [tab, setTab] = useState('edit');
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [out, setOut] = useState('');
  const [sys, setSys] = useState('你是轻阅读的资深文学编辑，请依据以下稿件正文，判断题材、情绪基调与潜在风险，输出结构化 JSON。');
  const [usr, setUsr] = useState('稿件标题：{{title}}\n稿件正文：{{content}}\n请输出：{ "genre": ..., "mood": ..., "risk": ... }');
  const change = (setter) => (e) => { setter(e.target.value); setDirty(true); };
  async function runTest() {
    setTesting(false);
    setOut('Prompt 试运行接口尚未实现，本次没有调用 AI 服务。');
    ctx.push('Prompt 试运行接口尚未实现', 'info');
  }
  function tryBack() { if (dirty) setLeaving(true); else onBack(); }
  async function publish() {
    ctx.push('Prompt 发布接口尚未实现，未修改线上版本。', 'info');
  }

  return (
    <div className="page wide fade-in">
      <div className="phead">
        <div>
          <button className="btn ghost sm" onClick={tryBack} style={{ marginBottom: 12 }}>← 返回 Prompt 列表</button>
          <div className="eyebrow">— Prompt Editor —</div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>{p?.name || '新建 Prompt'} {p?.draft && <VersionBadge v={p.draft} label="草稿" />}</h1>
        </div>
        <div className="pactions">
          {dirty && <span style={{ alignSelf: 'center' }}><StatusBadge kind="warn">未保存修改</StatusBadge></span>}
          <button className="btn ghost" onClick={onCompare}>版本对比</button>
          <button className="btn subtle" onClick={() => ctx.push('Prompt 草稿保存接口尚未实现，当前修改未写入服务器。', 'info')}>保存草稿</button>
          <button className="btn" onClick={publish}>发布版本</button>
        </div>
      </div>
      <div className="banner info" style={{ marginBottom: 16 }}><span className="bd" /><span className="bx">当前仅接入 Prompt 列表摘要；版本正文、保存、发布、回滚和试运行接口仍待后端实现。</span></div>
      <div className="tabs">
        <button className={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>编辑</button>
        <button className={tab === 'test' ? 'on' : ''} onClick={() => setTab('test')}>测试</button>
        <button className={tab === 'rec' ? 'on' : ''} onClick={() => setTab('rec')}>修改记录</button>
      </div>
      {tab === 'edit' && <div className="fade-in">
        <div className="card">
          <div className="fld-row">
            <div className="fld"><label className="lbl">Prompt 名称<span className="req">必填</span></label><input className="inp" defaultValue={p?.name} onChange={change(() => {})} placeholder="例如：稿件内容分析" /></div>
            <div className="fld"><label className="lbl">使用场景<span className="req">必填</span></label><select className="inp" defaultValue={p?.scene}><option>稿件内容分析</option><option>AI 标签生成</option><option>推荐理由生成</option><option>风险内容识别</option></select></div>
          </div>
          <div className="fld"><label className="lbl">版本说明</label><input className="inp" onChange={change(() => {})} placeholder="简述本版本的调整，便于审计与回溯" /></div>
        </div>
        <div className="card">
          <div className="card-h"><div className="ct">系统提示词</div></div>
          <textarea className="inp" rows={4} value={sys} onChange={change(setSys)} />
        </div>
        <div className="card">
          <div className="card-h"><div className="ct">用户提示词模板</div></div>
          <textarea className="inp mono" rows={5} value={usr} onChange={change(setUsr)} />
          <div className="impact" style={{ marginTop: 14 }}><div className="il">可用变量</div><span className="mono">{'{{title}}'}</span> 稿件标题 · <span className="mono">{'{{content}}'}</span> 稿件正文 · <span className="mono">{'{{author}}'}</span> 作者笔名</div>
        </div>
      </div>}
      {tab === 'test' && <div className="fade-in card">
        <div className="fld"><label className="lbl">测试输入</label><textarea className="inp" rows={4} placeholder="粘贴一段稿件正文用于试运行（仅测试，不影响线上）" /></div>
        <button className="btn" onClick={runTest} disabled={testing}>{testing ? <><Spin />测试中…</> : <><Icon id="bolt" size={14} className="btn-ico" />测试 Prompt</>}</button>
        <div className="fld" style={{ marginTop: 18 }}><label className="lbl">测试输出</label>
          {testing ? <LoadingState rows={2} /> : out ? <pre className="mono" style={{ background: 'var(--panel-2)', border: '1px solid var(--rule)', borderRadius: 'var(--radius-sm)', padding: 16, fontSize: 12.5, lineHeight: 1.7, margin: 0, color: 'var(--ink-2)' }}>{out}</pre> : <EmptyState icon="bolt" title="尚未运行测试" desc="填写测试输入并点击「测试 Prompt」查看输出。" />}
        </div>
      </div>}
      {tab === 'rec' && <div className="fade-in card pad0"><table className="tbl"><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>说明</th></tr></thead><tbody>
        <tr><td className="t-mono">今天 10:22</td><td>林望舒</td><td>编辑草稿</td><td>补充风险词判定说明</td></tr>
        <tr><td className="t-mono">3 天前</td><td>林望舒</td><td>发布 v8</td><td>优化题材判定</td></tr>
        <tr><td className="t-mono">8 天前</td><td>陈墨</td><td>发布 v7</td><td>初版</td></tr>
      </tbody></table></div>}
      <UnsavedChangesDialog open={leaving} onStay={() => setLeaving(false)} onLeave={() => { setLeaving(false); onBack(); }} />
    </div>
  );
}

export function PromptVersionCompare({ onBack }) {
  return (
    <div className="page wide fade-in">
      <div className="phead"><div><button className="btn ghost sm" onClick={onBack} style={{ marginBottom: 12 }}>← 返回编辑</button><div className="eyebrow">— Version Compare —</div><h1>版本对比 · v8 → v9（草稿）</h1></div></div>
      <div className="banner info" style={{ marginBottom: 16 }}><span className="bd" /><span className="bx">以下为设计预览；版本详情与对比接口尚未实现。</span></div>
      <div className="diff">
        <div className="dc"><div className="dc-h"><span>v8 · 当前生效</span><VersionBadge v="v8" /></div><div className="dc-b">你是轻阅读的资深文学编辑，请依据以下稿件正文，判断题材与情绪基调，<span className="del">输出结构化 JSON。</span></div></div>
        <div className="dc"><div className="dc-h"><span>v9 · 草稿</span><VersionBadge v="v9" label="草稿" /></div><div className="dc-b">你是轻阅读的资深文学编辑，请依据以下稿件正文，判断题材与情绪基调，<span className="add">判断潜在风险，输出结构化 JSON。</span></div></div>
      </div>
    </div>
  );
}

export function VersionHistoryDrawer({ title, onClose }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><div className="mi info"><Icon id="clock" size={19} /></div><div><div className="mt">{title}</div><div className="md">所有已发布版本均可查看与回滚。</div></div></div>
        <div className="modal-body"><EmptyState title="版本历史尚未接入" desc="后端版本详情与历史查询接口实现后会显示真实记录。" /></div>
        <div className="modal-foot"><button className="btn ghost" onClick={onClose}>关闭</button></div>
      </div>
    </div>
  );
}

/* ── 3. 标签词表 ── */
export function TagVocabulary({ ctx }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const loadVersions = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { setVersions(await staffApi.vocabularyVersions()); }
    catch (error) { setLoadError(errorMessage(error, '词表版本读取失败。')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(loadVersions, 0);
    return () => clearTimeout(timer);
  }, [loadVersions]);
  return (
    <div className="page wide fade-in">
      <div className="phead">
        <div><div className="eyebrow">— Tag Lexicon —</div><h1>标签词表</h1><p className="lead">AI 打标与推荐所依据的标签分类与词条。有使用记录的标签建议停用而非删除。</p></div>
        <div className="pactions">
          <button className="btn ghost" onClick={() => ctx.push('词表 CSV 导出接口尚未实现。', 'info')}><Icon id="download" size={14} className="btn-ico" />导出词表</button>
          <button className="btn" onClick={() => ctx.push('词表发布接口尚未实现，未修改线上版本。', 'info')}><Icon id="check" size={14} className="btn-ico" />发布词表版本</button>
        </div>
      </div>
      <div className="banner info" style={{ marginBottom: 16 }}><span className="bd" /><span className="bx">目前已接入真实词表版本列表；分类与词条 CRUD 接口尚未实现。</span></div>
      <div className="card pad0">
        {loading && <LoadingState rows={4} />}
        {!loading && loadError && <ErrorState desc={loadError} onRetry={loadVersions} />}
        {!loading && !loadError && versions.length === 0 && <EmptyState title="暂无词表版本" desc="数据库中尚未创建标签词表版本。" />}
        {!loading && !loadError && versions.length > 0 && <table className="tbl"><thead><tr><th>版本</th><th>状态</th><th>分类数</th><th>变更说明</th><th>发布时间</th></tr></thead><tbody>
          {versions.map((v) => <tr key={v.id}><td><VersionBadge v={versionLabel(v.version_no)} /></td><td><StatusBadge kind={v.status === 'published' ? 'ok' : (v.status === 'draft' ? 'warn' : 'mute')}>{v.status === 'published' ? '已发布' : (v.status === 'draft' ? '草稿' : '已归档')}</StatusBadge></td><td className="t-num">{v.category_count}</td><td>{v.change_note || '—'}</td><td className="t-mono">{formatDateTime(v.published_at)}</td></tr>)}
        </tbody></table>}
      </div>
    </div>
  );
}

/* ── 4. 推荐策略 ── */
export function RecommendationStrategy({ ctx }) {
  const [view, setView] = useState('list');
  const [strategies, setStrategies] = useState([]);
  const [cur, setCur] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const loadStrategies = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { setStrategies((await staffApi.strategies()).map(toUiStrategy)); }
    catch (error) { setLoadError(errorMessage(error, '推荐策略读取失败。')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(loadStrategies, 0);
    return () => clearTimeout(timer);
  }, [loadStrategies]);
  if (view === 'editor') return <StrategyEditor s={cur} ctx={ctx} onBack={() => setView('list')} onSim={() => ctx.go('sim')} />;
  return (
    <div className="page wide fade-in">
      <div className="phead">
        <div><div className="eyebrow">— Recommendation —</div><h1>推荐策略</h1><p className="lead">管理推荐流的权重与规则。草稿可先运行模拟，确认效果后再发布。</p></div>
        <div className="pactions"><button className="btn" onClick={() => { setCur(null); setView('editor'); }}><Icon id="plus" size={14} className="btn-ico" />新建策略</button></div>
      </div>
      <div className="card pad0">
        {loading && <LoadingState rows={4} />}
        {!loading && loadError && <ErrorState desc={loadError} onRetry={loadStrategies} />}
        {!loading && !loadError && strategies.length === 0 && <EmptyState title="暂无推荐策略" desc="数据库中尚未创建推荐策略。" />}
        {!loading && !loadError && strategies.length > 0 && <table className="tbl"><thead><tr><th>策略 / 场景</th><th>版本</th><th>状态</th><th>最近更新</th><th style={{ textAlign: 'right' }}>操作</th></tr></thead><tbody>
          {strategies.map((s) => <tr key={s.id}><td><div className="t-name">{s.name}</div><div className="t-sub">{s.scene}</div></td><td><VersionBadge v={s.ver} /></td><td><StatusBadge kind={(PROMPT_STATUS[s.status] || PROMPT_STATUS.draft)[0]}>{(PROMPT_STATUS[s.status] || PROMPT_STATUS.draft)[1]}</StatusBadge></td><td><div className="t-mono">{s.at}</div><div className="t-sub">{s.by}</div></td><td><div className="t-actions"><button className="rowbtn" onClick={() => { setCur(s); setView('editor'); }}>查看编辑器</button><button className="rowbtn" onClick={() => ctx.push('策略复制接口尚未实现。', 'info')}>复制</button><button className="rowbtn" onClick={() => ctx.go('sim')}>运行模拟</button><button className="rowbtn" onClick={() => ctx.push('策略历史接口尚未实现。', 'info')}>历史</button></div></td></tr>)}
        </tbody></table>}
      </div>
    </div>
  );
}

export function StrategyEditor({ s, ctx, onBack, onSim }) {
  const [w, setW] = useState({ tag: 40, hot: 20, fresh: 15, editor: 20, risk: 5 });
  const [thr, setThr] = useState(0.6);
  const [count, setCount] = useState(12);
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const total = w.tag + w.hot + w.fresh + w.editor + w.risk;
  const okTotal = total === 100;
  const set = (k, v) => { setW((p) => ({ ...p, [k]: Math.max(0, Math.min(100, +v || 0)) })); setDirty(true); };
  const WEIGHTS = [['tag', '标签匹配权重', '稿件标签与用户偏好的契合度'], ['hot', '热度权重', '近期阅读与互动热度'], ['fresh', '新鲜度权重', '稿件发布时间新近度'], ['editor', '编辑推荐权重', '编辑手动推荐的加权'], ['risk', '风险内容降权', '命中风险标签的降权强度']];
  async function publish() {
    if (!okTotal) { ctx.push('权重总和须为 100% 才能发布', 'err'); return; }
    ctx.push('策略发布接口尚未实现，未修改线上版本。', 'info');
  }
  function tryBack() { dirty ? setLeaving(true) : onBack(); }
  return (
    <div className="page fade-in">
      <div className="phead">
        <div><button className="btn ghost sm" onClick={tryBack} style={{ marginBottom: 12 }}>← 返回策略列表</button><div className="eyebrow">— Strategy Editor —</div><h1>{s?.name || '新建策略'}</h1></div>
        <div className="pactions">{dirty && <span style={{ alignSelf: 'center' }}><StatusBadge kind="warn">未保存修改</StatusBadge></span>}<button className="btn subtle" onClick={onSim}><Icon id="sim" size={14} className="btn-ico" />运行模拟</button><button className="btn ghost" onClick={() => ctx.push('策略草稿保存接口尚未实现，当前修改未写入服务器。', 'info')}>保存草稿</button><button className="btn" onClick={publish}>发布策略</button></div>
      </div>
      <div className="banner info" style={{ marginBottom: 16 }}><span className="bd" /><span className="bx">当前策略详情、草稿保存与发布接口尚未实现；本页为编辑交互预览，不会写入服务器。</span></div>
      <div className="card">
        <div className="card-h"><div className="ct">权重配置</div><div className="muted" style={{ fontSize: 12 }}>权重总和须为 100%</div></div>
        {WEIGHTS.map(([k, label, sub]) => (
          <div className="weight-row" key={k}>
            <div className="wr-l">{label}<div className="wr-s">{sub}</div></div>
            <input type="range" min="0" max="100" value={w[k]} onChange={(e) => set(k, e.target.value)} />
            <div className="wr-n"><input type="number" value={w[k]} onChange={(e) => set(k, e.target.value)} /><span className="pct">%</span></div>
          </div>
        ))}
        <div className={'weight-total ' + (okTotal ? 'ok' : 'bad')}>
          <span>{okTotal ? '权重总和符合发布条件' : '权重总和须为 100%，当前不符合发布条件'}</span>
          <span className="wt-v">{total}%</span>
        </div>
      </div>
      <div className="card">
        <div className="card-h"><div className="ct">阈值与兜底</div></div>
        <div className="fld-row">
          <div className="fld"><label className="lbl">最低匹配阈值</label><input className="inp" type="number" step="0.05" value={thr} onChange={(e) => { setThr(+e.target.value); setDirty(true); }} /><div className="help">低于该分值的候选不进入推荐。</div></div>
          <div className="fld"><label className="lbl">推荐结果数量</label><input className="inp" type="number" value={count} onChange={(e) => { setCount(+e.target.value); setDirty(true); }} /></div>
        </div>
        <div className="fld"><label className="lbl">兜底策略</label><select className="inp" onChange={() => setDirty(true)}><option>候选不足时补充热门稿件</option><option>候选不足时补充最新稿件</option><option>候选不足时补充编辑精选</option></select></div>
      </div>
      <UnsavedChangesDialog open={leaving} onStay={() => setLeaving(false)} onLeave={() => { setLeaving(false); onBack(); }} />
    </div>
  );
}

/* ── 5. 策略模拟 ── */
export function StrategySimulator({ ctx }) {
  const [running, setRunning] = useState(false);
  async function run() {
    setRunning(true);
    setRunning(false);
    ctx.push('策略模拟接口尚未实现，本次没有生成模拟结果。', 'info');
  }
  return (
    <div className="page wide fade-in">
      <div className="phead"><div><div className="eyebrow">— Strategy Simulator —</div><h1>策略模拟</h1><p className="lead">发布前预览推荐效果。模拟结果仅用于评估，不会直接影响线上推荐。</p></div></div>
      <div className="banner info" style={{ marginBottom: 16 }}><span className="bd" /><span className="bx">模拟结果仅用于评估，不会直接影响线上推荐。</span></div>
      <div className="filterbar">
        <div className="ff"><label className="lbl">待测策略版本</label><select className="inp"><option>新人作者扶持 v2（草稿）</option><option>默认推荐流 v3</option></select></div>
        <div className="ff"><label className="lbl">模拟对象</label><select className="inp"><option>偏好：治愈 / 都市</option><option>偏好：悬疑 / 快节奏</option><option>随机用户样本</option></select></div>
        <div className="ff"><label className="lbl">样本数量</label><select className="inp"><option>100</option><option>500</option><option>1000</option></select></div>
        <div className="fspacer" />
        <button className="btn" onClick={run} disabled={running}>{running ? <><Spin />运行中…</> : <><Icon id="sim" size={14} className="btn-ico" />运行模拟</>}</button>
      </div>
      {running ? <div className="card"><LoadingState rows={4} /></div>
        : <EmptyState icon="sim" title="策略模拟尚未接入" desc="后端模拟端点实现后，可在这里查看真实的草稿策略与线上策略对比。" />}
    </div>
  );
}

/* ── 6. 编辑配置日志 ── */
export function EditorialAuditLogs({ ctx }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const loadLogs = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { setLogs((await staffApi.editorialLogs()).map(toUiEditorialLog)); }
    catch (error) { setLoadError(errorMessage(error, '编辑配置日志读取失败。')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(loadLogs, 0);
    return () => clearTimeout(timer);
  }, [loadLogs]);
  return (
    <div className="page wide fade-in">
      <div className="phead"><div><div className="eyebrow">— Editorial Audit —</div><h1>编辑配置日志</h1><p className="lead">Prompt、标签与推荐策略的全部配置操作留痕，含操作人、时间与版本。</p></div><div className="pactions"><button className="btn ghost" onClick={() => ctx.push('CSV 导出端点尚未实现。', 'info')}><Icon id="download" size={14} className="btn-ico" />导出记录</button></div></div>
      <div className="filterbar">
        <div className="ff"><label className="lbl">模块</label><select className="inp"><option>全部</option><option>Prompt</option><option>标签词表</option><option>推荐策略</option></select></div>
        <div className="ff"><label className="lbl">操作</label><select className="inp"><option>全部</option><option>发布</option><option>回滚</option><option>测试</option><option>停用</option></select></div>
        <div className="ff"><label className="lbl">关键词</label><input className="inp" placeholder="搜索版本 / 说明 / 操作人" /></div>
        <div className="fspacer" /><button className="btn subtle" onClick={() => ctx.push('日志筛选参数尚未接入后端。', 'info')}>筛选</button><button className="btn ghost" onClick={loadLogs}>重置</button>
      </div>
      <div className="card pad0">
        {loading && <LoadingState rows={5} />}
        {!loading && loadError && <ErrorState desc={loadError} onRetry={loadLogs} />}
        {!loading && !loadError && logs.length === 0 && <EmptyState title="暂无编辑配置日志" desc="发布或修改配置后会在这里留下记录。" />}
        {!loading && !loadError && logs.length > 0 && <table className="tbl"><thead><tr><th>时间</th><th>操作人</th><th>模块</th><th>操作</th><th>版本</th><th>变更说明</th><th>结果</th><th style={{ textAlign: 'right' }}></th></tr></thead><tbody>
          {logs.map((l) => <tr key={l.id}><td className="t-mono">{l.t}</td><td>{l.who}</td><td>{l.mod}</td><td>{l.act}</td><td className="t-sub">{l.ver}</td><td style={{ maxWidth: 180 }}>{l.note}</td><td>{l.result}</td><td style={{ textAlign: 'right' }}><button className="rowbtn" onClick={() => ctx.push('日志详情端点尚未实现。', 'info')}>详情</button></td></tr>)}
        </tbody></table>}
      </div>
    </div>
  );
}

/* 接口状态：
 *   已接入：概览、Prompt 摘要列表、词表版本列表、策略摘要列表、编辑审计日志。
 *   待补：配置详情、草稿/发布/回滚/复制/历史、词条 CRUD、Prompt 试运行、策略模拟、筛选与 CSV。
 */
