// editorial.jsx — 编辑部负责人工作台（内容策略 · 文艺纸感主题）
// DOM / 类名 / 文案 / 内联样式逐字移植自 prototype-admin/editorial.jsx。
//
// 概览、配置详情、草稿、发布、回滚、词条状态与审计日志均接真实后端。
// Prompt 试运行、策略模拟、日志筛选与 CSV 导出均接真实能力。

import { useCallback, useEffect, useState } from 'react';
import Icon from './shared/Icon';
import { PROMPT_STATUS } from './shared/constants';
import { downloadCsv, staffApi, errorMessage, formatDateTime, toUiEditorialLog, toUiPrompt, toUiStrategy, versionLabel } from './api';
import { Spin, StatusBadge, VersionBadge, EmptyState, ErrorState, LoadingState } from './shared/ui';
import { UnsavedChangesDialog } from './shared/dialogs';

const INITIAL_EDITORIAL_LOG_FILTERS = { module: '', action_contains: '', q: '' };

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
          <button className="btn" onClick={() => ctx.go('prompt')}><Icon id="prompt" size={14} className="btn-ico" />管理 Prompt</button>
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
    if (!p.draft) return;
    try {
      const result = await staffApi.publishPrompt(p.id, Number(p.draft.replace('v', '')));
      ctx.push(`${p.name} ${versionLabel(result.version_no)} 已发布`, 'ok');
      await loadPrompts();
    } catch (error) { ctx.push(errorMessage(error, 'Prompt 发布失败。'), 'err'); }
  }

  if (view === 'editor') return <PromptEditor p={cur} ctx={ctx} onBack={() => { setView('list'); loadPrompts(); }} onCompare={() => setView('compare')} />;
  if (view === 'compare') return <PromptVersionCompare p={cur} onBack={() => setView('editor')} />;

  return (
    <div className="page wide fade-in">
      <div className="phead">
        <div><div className="eyebrow">— Prompt Library —</div><h1>Prompt 管理</h1><p className="lead">管理各使用场景的提示词及其版本。草稿修改不会立即影响线上，只有发布后生效。</p></div>
        <div className="pactions"><span className="muted">当前仅维护受保护的小说元数据打标 Prompt</span></div>
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
                  {p.status === 'published' && <button className="rowbtn" onClick={() => { setCur(p); setHistory(true); }}>选择回滚版本</button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
        }
      </div>
      {history && <VersionHistoryDrawer prompt={cur} ctx={ctx} onChanged={loadPrompts} onClose={() => setHistory(false)} />}
    </div>
  );
}

export function PromptEditor({ p, ctx, onBack, onCompare }) {
  const [tab, setTab] = useState('edit');
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [out, setOut] = useState('');
  const [testTitle, setTestTitle] = useState('');
  const [testIntro, setTestIntro] = useState('');
  const [testSample, setTestSample] = useState('');
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(p?.name || '');
  const [description, setDescription] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [sys, setSys] = useState('');
  const [usr, setUsr] = useState('');
  const change = (setter) => (e) => { setter(e.target.value); setDirty(true); };

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const value = await staffApi.prompt(p.id);
      setDetail(value);
      const editable = value.versions.find((item) => item.status === 'draft')
        || value.versions.find((item) => item.status === 'published')
        || value.versions[0];
      setName(value.name || '');
      setDescription(value.description || '');
      setChangeNote(editable?.change_note || '');
      setSys(editable?.system_prompt || '');
      setUsr(editable?.user_prompt_template || '');
      setDirty(false);
    } catch (error) { ctx.push(errorMessage(error, 'Prompt 详情读取失败。'), 'err'); }
    finally { setLoading(false); }
  }, [ctx, p.id]);
  useEffect(() => {
    const timer = setTimeout(loadDetail, 0);
    return () => clearTimeout(timer);
  }, [loadDetail]);

  function templateVariables() {
    const matches = `${sys}\n${usr}`.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g);
    return [...new Set([...matches].map((match) => match[1]))];
  }

  async function saveDraft() {
    setSaving(true);
    try {
      const editable = detail?.versions.find((item) => item.status === 'draft')
        || detail?.versions.find((item) => item.status === 'published');
      const result = await staffApi.savePromptDraft(p.id, {
        name, description, system_prompt: sys, user_prompt_template: usr,
        variables: templateVariables(), change_note: changeNote,
        expected_version_no: editable?.version_no,
      });
      ctx.push(`Prompt ${versionLabel(result.version_no)} 草稿已保存`, 'ok');
      await loadDetail();
      return result;
    } catch (error) {
      ctx.push(errorMessage(error, 'Prompt 草稿保存失败。'), 'err');
      return null;
    } finally { setSaving(false); }
  }
  async function runTest() {
    if (!testTitle.trim()) { ctx.push('请填写测试标题', 'err'); return; }
    setTesting(true); setOut('');
    try {
      const result = await staffApi.testPrompt(p.id, {
        system_prompt: sys,
        user_prompt_template: usr,
        variables: templateVariables(),
        title: testTitle,
        intro: testIntro,
        sample: testSample,
      });
      setOut(JSON.stringify(result.output, null, 2));
      ctx.push(`Prompt 试运行完成 · ${result.model_name}`, 'ok');
    } catch (error) {
      setOut(errorMessage(error, 'Prompt 试运行失败。'));
      ctx.push(errorMessage(error, 'Prompt 试运行失败。'), 'err');
    } finally { setTesting(false); }
  }
  function tryBack() { if (dirty) setLeaving(true); else onBack(); }
  async function publish() {
    const saved = dirty ? await saveDraft() : null;
    const draftVersion = saved?.version_no
      || detail?.versions.find((item) => item.status === 'draft')?.version_no;
    if (!draftVersion) { ctx.push('请先保存一个 Prompt 草稿', 'err'); return; }
    try {
      const result = await staffApi.publishPrompt(p.id, draftVersion);
      ctx.push(`Prompt ${versionLabel(result.version_no)} 已发布并成为运行时配置`, 'ok');
      await loadDetail();
    } catch (error) { ctx.push(errorMessage(error, 'Prompt 发布失败。'), 'err'); }
  }

  if (loading) return <div className="page wide fade-in"><LoadingState rows={5} /></div>;
  return (
    <div className="page wide fade-in">
      <div className="phead">
        <div>
          <button className="btn ghost sm" onClick={tryBack} style={{ marginBottom: 12 }}>← 返回 Prompt 列表</button>
          <div className="eyebrow">— Prompt Editor —</div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>{name || p?.name} {detail?.latest_draft_version && <VersionBadge v={versionLabel(detail.latest_draft_version)} label="草稿" />}</h1>
        </div>
        <div className="pactions">
          {dirty && <span style={{ alignSelf: 'center' }}><StatusBadge kind="warn">未保存修改</StatusBadge></span>}
          <button className="btn ghost" onClick={onCompare}>版本对比</button>
          <button className="btn subtle" onClick={saveDraft} disabled={saving}>{saving ? <><Spin />保存中…</> : '保存草稿'}</button>
          <button className="btn" onClick={publish} disabled={saving}>发布版本</button>
        </div>
      </div>
      <div className="banner info" style={{ marginBottom: 16 }}><span className="bd" /><span className="bx">草稿保存、原子发布和历史回滚已接入真实配置。正文变量被服务端禁止，只允许标题、扉页语与内容简介。</span></div>
      <div className="tabs">
        <button className={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>编辑</button>
        <button className={tab === 'test' ? 'on' : ''} onClick={() => setTab('test')}>测试</button>
        <button className={tab === 'rec' ? 'on' : ''} onClick={() => setTab('rec')}>修改记录</button>
      </div>
      {tab === 'edit' && <div className="fade-in">
        <div className="card">
          <div className="fld-row">
            <div className="fld"><label className="lbl">Prompt 名称<span className="req">必填</span></label><input className="inp" value={name} onChange={change(setName)} /></div>
            <div className="fld"><label className="lbl">使用场景<span className="ro">只读</span></label><input className="inp" value={detail?.use_case || p?.scene || ''} disabled readOnly /></div>
          </div>
          <div className="fld"><label className="lbl">配置说明</label><input className="inp" value={description} onChange={change(setDescription)} /></div>
          <div className="fld"><label className="lbl">版本说明</label><input className="inp" value={changeNote} onChange={change(setChangeNote)} placeholder="简述本版本的调整，便于审计与回溯" /></div>
        </div>
        <div className="card">
          <div className="card-h"><div className="ct">系统提示词</div></div>
          <textarea className="inp" rows={4} value={sys} onChange={change(setSys)} />
        </div>
        <div className="card">
          <div className="card-h"><div className="ct">用户提示词模板</div></div>
          <textarea className="inp mono" rows={5} value={usr} onChange={change(setUsr)} />
          <div className="impact" style={{ marginTop: 14 }}><div className="il">唯一允许变量</div><span className="mono">{'{{title}}'}</span> 标题 · <span className="mono">{'{{intro}}'}</span> 扉页语 · <span className="mono">{'{{sample}}'}</span> 内容简介；正文变量会被服务端拒绝。</div>
        </div>
      </div>}
      {tab === 'test' && <div className="fade-in card">
        <div className="banner info" style={{ marginBottom: 16 }}><span className="bd" /><span className="bx">点击试运行会调用已配置的外部模型，但只发送以下标题、扉页语与简介；不会保存为稿件或修改线上 Prompt。</span></div>
        <div className="fld"><label className="lbl">测试标题<span className="req">必填</span></label><input className="inp" value={testTitle} onChange={(e) => setTestTitle(e.target.value)} placeholder="例如：雨停在旧车站" /></div>
        <div className="fld"><label className="lbl">测试扉页语</label><input className="inp" value={testIntro} onChange={(e) => setTestIntro(e.target.value)} placeholder="一句简短的作品引语" /></div>
        <div className="fld"><label className="lbl">测试内容简介</label><textarea className="inp" rows={5} value={testSample} onChange={(e) => setTestSample(e.target.value)} placeholder="只填写内容简介，不粘贴正文" /></div>
        <button className="btn" onClick={runTest} disabled={testing}>{testing ? <><Spin />测试中…</> : <><Icon id="bolt" size={14} className="btn-ico" />测试 Prompt</>}</button>
        <div className="fld" style={{ marginTop: 18 }}><label className="lbl">测试输出</label>
          {testing ? <LoadingState rows={2} /> : out ? <pre className="mono" style={{ background: 'var(--panel-2)', border: '1px solid var(--rule)', borderRadius: 'var(--radius-sm)', padding: 16, fontSize: 12.5, lineHeight: 1.7, margin: 0, color: 'var(--ink-2)' }}>{out}</pre> : <EmptyState icon="bolt" title="尚未运行测试" desc="填写测试输入并点击「测试 Prompt」查看输出。" />}
        </div>
      </div>}
      {tab === 'rec' && <div className="fade-in card pad0"><table className="tbl"><thead><tr><th>版本</th><th>状态</th><th>创建时间</th><th>说明</th></tr></thead><tbody>
        {(detail?.versions || []).map((version) => <tr key={version.id}><td><VersionBadge v={versionLabel(version.version_no)} /></td><td>{version.status}</td><td className="t-mono">{formatDateTime(version.published_at || version.created_at)}</td><td>{version.change_note || '—'}</td></tr>)}
      </tbody></table></div>}
      <UnsavedChangesDialog open={leaving} onStay={() => setLeaving(false)} onLeave={() => { setLeaving(false); onBack(); }} />
    </div>
  );
}

export function PromptVersionCompare({ p, onBack }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    staffApi.prompt(p.id)
      .then((value) => { if (active) setDetail(value); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [p.id]);
  const published = detail?.versions?.find((item) => item.status === 'published');
  const draft = detail?.versions?.find((item) => item.status === 'draft');
  return (
    <div className="page wide fade-in">
      <div className="phead"><div><button className="btn ghost sm" onClick={onBack} style={{ marginBottom: 12 }}>← 返回编辑</button><div className="eyebrow">— Version Compare —</div><h1>版本对比 · {published ? versionLabel(published.version_no) : '—'} → {draft ? `${versionLabel(draft.version_no)}（草稿）` : '暂无草稿'}</h1></div></div>
      <div className="banner info" style={{ marginBottom: 16 }}><span className="bd" /><span className="bx">显示数据库中的真实版本正文；发布前请重点检查隐私边界、变量与固定输出结构。</span></div>
      {loading && <LoadingState rows={4} />}
      {!loading && <div className="diff">
        <div className="dc"><div className="dc-h"><span>当前生效</span><VersionBadge v={published ? versionLabel(published.version_no) : '—'} /></div><pre className="dc-b mono" style={{ whiteSpace: 'pre-wrap' }}>{published ? `${published.system_prompt}\n\n${published.user_prompt_template}` : '暂无已发布版本'}</pre></div>
        <div className="dc"><div className="dc-h"><span>待发布草稿</span><VersionBadge v={draft ? versionLabel(draft.version_no) : '—'} label="草稿" /></div><pre className="dc-b mono" style={{ whiteSpace: 'pre-wrap' }}>{draft ? `${draft.system_prompt}\n\n${draft.user_prompt_template}` : '保存草稿后可在这里对比'}</pre></div>
      </div>}
    </div>
  );
}

export function VersionHistoryDrawer({ prompt, ctx, onChanged, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    staffApi.prompt(prompt.id)
      .then((value) => { if (active) setDetail(value); })
      .catch((error) => ctx.push(errorMessage(error, '版本历史读取失败。'), 'err'))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ctx, prompt.id]);
  async function rollback(versionNo) {
    try {
      const result = await staffApi.rollbackPrompt(prompt.id, versionNo, `回滚至 v${versionNo} 的内容`);
      ctx.push(`已基于 v${versionNo} 创建并发布新版本 ${versionLabel(result.version_no)}`, 'ok');
      await onChanged();
      onClose();
    } catch (error) { ctx.push(errorMessage(error, 'Prompt 回滚失败。'), 'err'); }
  }
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><div className="mi info"><Icon id="clock" size={19} /></div><div><div className="mt">{prompt.name} · 版本历史</div><div className="md">回滚不会覆盖历史，而是复制旧内容并发布一个新版本。</div></div></div>
        <div className="modal-body">
          {loading && <LoadingState rows={3} />}
          {!loading && !detail?.versions?.length && <EmptyState title="暂无版本历史" desc="保存第一个版本后会显示在这里。" />}
          {!loading && detail?.versions?.length > 0 && <table className="tbl"><thead><tr><th>版本</th><th>状态</th><th>说明</th><th></th></tr></thead><tbody>{detail.versions.map((version) => <tr key={version.id}><td><VersionBadge v={versionLabel(version.version_no)} /></td><td>{version.status}</td><td>{version.change_note || '—'}</td><td style={{ textAlign: 'right' }}>{version.status === 'archived' && <button className="rowbtn" onClick={() => rollback(version.version_no)}>回滚到此内容</button>}</td></tr>)}</tbody></table>}
        </div>
        <div className="modal-foot"><button className="btn ghost" onClick={onClose}>关闭</button></div>
      </div>
    </div>
  );
}

/* ── 3. 标签词表 ── */
export function TagVocabulary({ ctx }) {
  const [versions, setVersions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [termForm, setTermForm] = useState(null);
  const loadVersions = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const rows = await staffApi.vocabularyVersions();
      setVersions(rows);
      const next = rows.find((item) => item.status === 'draft')
        || rows.find((item) => item.status === 'published') || rows[0];
      if (next) setSelected(next);
    }
    catch (error) { setLoadError(errorMessage(error, '词表版本读取失败。')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(loadVersions, 0);
    return () => clearTimeout(timer);
  }, [loadVersions]);
  const loadDetail = useCallback(async (version) => {
    if (!version) return;
    setDetailLoading(true);
    try { setDetail(await staffApi.vocabularyVersion(version.id)); }
    catch (error) { ctx.push(errorMessage(error, '词表详情读取失败。'), 'err'); }
    finally { setDetailLoading(false); }
  }, [ctx]);
  useEffect(() => {
    if (!selected) return undefined;
    const timer = setTimeout(() => loadDetail(selected), 0);
    return () => clearTimeout(timer);
  }, [loadDetail, selected]);
  async function createDraft() {
    try {
      const result = await staffApi.createVocabularyDraft('调整受控词表');
      ctx.push(`词表 ${versionLabel(result.version_no)} 草稿已创建`, 'ok');
      await loadVersions();
    } catch (error) { ctx.push(errorMessage(error, '词表草稿创建失败。'), 'err'); }
  }
  async function toggleTerm(term) {
    if (selected?.status !== 'draft') return;
    try {
      await staffApi.updateVocabularyTerm(selected.id, term.id, {
        name: term.name, description: term.description || '', synonyms: term.synonyms || [],
        status: term.status === 'active' ? 'disabled' : 'active',
      });
      ctx.push(`${term.name} 已${term.status === 'active' ? '停用' : '启用'}（草稿）`, 'ok');
      await loadDetail(selected);
    } catch (error) { ctx.push(errorMessage(error, '词条修改失败。'), 'err'); }
  }
  async function saveTerm() {
    if (!termForm?.name?.trim()) { ctx.push('请填写词条名称', 'err'); return; }
    const body = {
      name: termForm.name,
      description: termForm.description || '',
      synonyms: (termForm.synonyms || '').split(/[,，]/).map((item) => item.trim()).filter(Boolean),
    };
    try {
      if (termForm.mode === 'edit') {
        await staffApi.updateVocabularyTerm(selected.id, termForm.term.id, {
          ...body, status: termForm.term.status,
        });
        ctx.push(`词条已更新为“${body.name}”`, 'ok');
      } else {
        await staffApi.createVocabularyTerm(selected.id, termForm.category.id, body);
        ctx.push(`已新增词条“${body.name}”`, 'ok');
      }
      setTermForm(null);
      await loadDetail(selected);
    } catch (error) { ctx.push(errorMessage(error, '词条保存失败。'), 'err'); }
  }
  async function publish() {
    if (selected?.status !== 'draft') { ctx.push('请先创建或选择一个词表草稿', 'err'); return; }
    try {
      const result = await staffApi.publishVocabulary(selected.id, selected.version_no);
      ctx.push(`词表 ${versionLabel(result.version_no)} 已发布`, 'ok');
      await loadVersions();
    } catch (error) { ctx.push(errorMessage(error, '词表发布失败。'), 'err'); }
  }
  async function rollback(versionNo) {
    try {
      const result = await staffApi.rollbackVocabulary(versionNo, `回滚至 v${versionNo} 的内容`);
      ctx.push(`已基于 v${versionNo} 发布新词表 ${versionLabel(result.version_no)}`, 'ok');
      await loadVersions();
    } catch (error) { ctx.push(errorMessage(error, '词表回滚失败。'), 'err'); }
  }
  return (
    <div className="page wide fade-in">
      <div className="phead">
        <div><div className="eyebrow">— Tag Lexicon —</div><h1>标签词表</h1><p className="lead">AI 打标与推荐所依据的标签分类与词条。有使用记录的标签建议停用而非删除。</p></div>
        <div className="pactions">
          {!versions.some((item) => item.status === 'draft') && <button className="btn ghost" onClick={createDraft}><Icon id="plus" size={14} className="btn-ico" />基于当前版本创建草稿</button>}
          <button className="btn" onClick={publish} disabled={selected?.status !== 'draft'}><Icon id="check" size={14} className="btn-ico" />发布所选草稿</button>
        </div>
      </div>
      <div className="banner info" style={{ marginBottom: 16 }}><span className="bd" /><span className="bx">词表采用“复制当前发布版 → 在草稿中停用或启用词条 → 原子发布”的流程；历史版本不会被覆盖。</span></div>
      <div className="card pad0">
        {loading && <LoadingState rows={4} />}
        {!loading && loadError && <ErrorState desc={loadError} onRetry={loadVersions} />}
        {!loading && !loadError && versions.length === 0 && <EmptyState title="暂无词表版本" desc="数据库中尚未创建标签词表版本。" />}
        {!loading && !loadError && versions.length > 0 && <table className="tbl"><thead><tr><th>版本</th><th>状态</th><th>分类数</th><th>变更说明</th><th>发布时间</th><th></th></tr></thead><tbody>
          {versions.map((v) => <tr key={v.id}><td><VersionBadge v={versionLabel(v.version_no)} /></td><td><StatusBadge kind={v.status === 'published' ? 'ok' : (v.status === 'draft' ? 'warn' : 'mute')}>{v.status === 'published' ? '已发布' : (v.status === 'draft' ? '草稿' : '已归档')}</StatusBadge></td><td className="t-num">{v.category_count}</td><td>{v.change_note || '—'}</td><td className="t-mono">{formatDateTime(v.published_at)}</td><td><div className="t-actions"><button className="rowbtn" onClick={() => setSelected(v)}>查看词条</button>{v.status === 'archived' && <button className="rowbtn" onClick={() => rollback(v.version_no)}>回滚此内容</button>}</div></td></tr>)}
        </tbody></table>}
      </div>
      {selected && <div className="card">
        <div className="card-h"><div className="ct">{versionLabel(selected.version_no)} · 受控词条</div><div className="muted">{selected.status === 'draft' ? '可编辑草稿' : '只读版本'}</div></div>
        {detailLoading && <LoadingState rows={4} />}
        {termForm && <div className="card" style={{ background: 'var(--panel-2)' }}><div className="card-h"><div className="ct">{termForm.mode === 'edit' ? '编辑词条' : `新增词条 · ${termForm.category.name}`}</div></div><div className="fld-row"><div className="fld"><label className="lbl">词条名称</label><input className="inp" value={termForm.name} onChange={(e) => setTermForm((value) => ({ ...value, name: e.target.value }))} /></div><div className="fld"><label className="lbl">同义词<span className="ro">逗号分隔</span></label><input className="inp" value={termForm.synonyms} onChange={(e) => setTermForm((value) => ({ ...value, synonyms: e.target.value }))} /></div></div><div className="fld"><label className="lbl">词条说明</label><input className="inp" value={termForm.description} onChange={(e) => setTermForm((value) => ({ ...value, description: e.target.value }))} /></div><div style={{ display: 'flex', gap: 8 }}><button className="btn" onClick={saveTerm}>保存词条</button><button className="btn ghost" onClick={() => setTermForm(null)}>取消</button></div></div>}
        {!detailLoading && detail?.categories?.map((category) => <div key={category.id} style={{ marginBottom: 18 }}><div className="t-name" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>{category.name}<span className="t-sub">{category.description}</span>{selected.status === 'draft' && <button className="rowbtn" onClick={() => setTermForm({ mode: 'create', category, name: '', description: '', synonyms: '' })}>新增词条</button>}</div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{category.terms.map((term) => <span key={term.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><button className={`btn ${term.status === 'active' ? 'ghost' : 'subtle'} sm`} disabled={selected.status !== 'draft'} onClick={() => toggleTerm(term)}>{term.name}{term.status === 'disabled' ? ' · 已停用' : ''}</button>{selected.status === 'draft' && <button className="rowbtn" onClick={() => setTermForm({ mode: 'edit', category, term, name: term.name, description: term.description || '', synonyms: (term.synonyms || []).join('，') })}>编辑</button>}</span>)}</div></div>)}
      </div>}
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
  if (view === 'editor') return <StrategyEditor s={cur} ctx={ctx} onBack={() => { setView('list'); loadStrategies(); }} onSim={() => ctx.go('sim')} />;
  return (
    <div className="page wide fade-in">
      <div className="phead">
        <div><div className="eyebrow">— Recommendation —</div><h1>推荐策略</h1><p className="lead">管理推荐流的权重与规则。草稿可先运行模拟，确认效果后再发布。</p></div>
        <div className="pactions"><span className="muted">当前维护默认情绪标签匹配策略</span></div>
      </div>
      <div className="card pad0">
        {loading && <LoadingState rows={4} />}
        {!loading && loadError && <ErrorState desc={loadError} onRetry={loadStrategies} />}
        {!loading && !loadError && strategies.length === 0 && <EmptyState title="暂无推荐策略" desc="数据库中尚未创建推荐策略。" />}
        {!loading && !loadError && strategies.length > 0 && <table className="tbl"><thead><tr><th>策略 / 场景</th><th>版本</th><th>状态</th><th>最近更新</th><th style={{ textAlign: 'right' }}>操作</th></tr></thead><tbody>
          {strategies.map((s) => <tr key={s.id}><td><div className="t-name">{s.name}</div><div className="t-sub">{s.scene}</div></td><td><VersionBadge v={s.ver} /></td><td><StatusBadge kind={(PROMPT_STATUS[s.status] || PROMPT_STATUS.draft)[0]}>{(PROMPT_STATUS[s.status] || PROMPT_STATUS.draft)[1]}</StatusBadge></td><td><div className="t-mono">{s.at}</div><div className="t-sub">{s.by}</div></td><td><div className="t-actions"><button className="rowbtn" onClick={() => { setCur(s); setView('editor'); }}>编辑与版本历史</button><button className="rowbtn" onClick={() => ctx.go('sim')}>运行模拟</button></div></td></tr>)}
        </tbody></table>}
      </div>
    </div>
  );
}

export function StrategyEditor({ s, ctx, onBack, onSim }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(s?.name || '');
  const [description, setDescription] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [w, setW] = useState({ setting: 15, tone: 40, relationship: 45 });
  const [maxScore, setMaxScore] = useState(96);
  const [count, setCount] = useState(6);
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const total = w.setting + w.tone + w.relationship;
  const okTotal = total === 100;
  const set = (k, v) => { setW((p) => ({ ...p, [k]: Math.max(0, Math.min(100, +v || 0)) })); setDirty(true); };
  const WEIGHTS = [['setting', '时代设定权重', '现代、古风、民国等背景匹配'], ['tone', '故事基调权重', '读者期望的主要情绪体验'], ['relationship', '关系内核权重', '人物关系模式与情感驱动力']];
  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const value = await staffApi.strategy(s.id);
      setDetail(value);
      const editable = value.versions.find((item) => item.status === 'draft')
        || value.versions.find((item) => item.status === 'published')
        || value.versions[0];
      const settings = editable?.settings || {};
      const weights = settings.weights || {};
      setName(value.name || '');
      setDescription(value.description || '');
      setChangeNote(editable?.change_note || '');
      setW({ setting: weights.setting ?? 15, tone: weights.story_tone ?? 40, relationship: weights.relationship_core ?? 45 });
      setMaxScore(settings.max_score ?? 96);
      setCount(settings.result_limit ?? 6);
      setDirty(false);
    } catch (error) { ctx.push(errorMessage(error, '推荐策略详情读取失败。'), 'err'); }
    finally { setLoading(false); }
  }, [ctx, s.id]);
  useEffect(() => {
    const timer = setTimeout(loadDetail, 0);
    return () => clearTimeout(timer);
  }, [loadDetail]);
  async function saveDraft() {
    if (!okTotal) { ctx.push('三项权重总和须为 100% 才能保存', 'err'); return null; }
    setSaving(true);
    try {
      const editable = detail?.versions.find((item) => item.status === 'draft')
        || detail?.versions.find((item) => item.status === 'published');
      const result = await staffApi.saveStrategyDraft(s.id, {
        name, description, setting_weight: w.setting, story_tone_weight: w.tone,
        relationship_core_weight: w.relationship, max_score: maxScore,
        result_limit: count, change_note: changeNote,
        expected_version_no: editable?.version_no,
      });
      ctx.push(`策略 ${versionLabel(result.version_no)} 草稿已保存`, 'ok');
      await loadDetail();
      return result;
    } catch (error) {
      ctx.push(errorMessage(error, '策略草稿保存失败。'), 'err');
      return null;
    } finally { setSaving(false); }
  }
  async function publish() {
    if (!okTotal) { ctx.push('权重总和须为 100% 才能发布', 'err'); return; }
    const saved = dirty ? await saveDraft() : null;
    const draftVersion = saved?.version_no
      || detail?.versions.find((item) => item.status === 'draft')?.version_no;
    if (!draftVersion) { ctx.push('请先保存一个推荐策略草稿', 'err'); return; }
    try {
      const result = await staffApi.publishStrategy(s.id, draftVersion);
      ctx.push(`策略 ${versionLabel(result.version_no)} 已发布并成为运行时配置`, 'ok');
      await loadDetail();
    } catch (error) { ctx.push(errorMessage(error, '策略发布失败。'), 'err'); }
  }
  async function rollback(versionNo) {
    try {
      const result = await staffApi.rollbackStrategy(s.id, versionNo, `回滚至 v${versionNo} 的内容`);
      ctx.push(`已基于 v${versionNo} 发布新策略 ${versionLabel(result.version_no)}`, 'ok');
      await loadDetail();
    } catch (error) { ctx.push(errorMessage(error, '策略回滚失败。'), 'err'); }
  }
  function tryBack() { dirty ? setLeaving(true) : onBack(); }
  if (loading) return <div className="page fade-in"><LoadingState rows={5} /></div>;
  return (
    <div className="page fade-in">
      <div className="phead">
        <div><button className="btn ghost sm" onClick={tryBack} style={{ marginBottom: 12 }}>← 返回策略列表</button><div className="eyebrow">— Strategy Editor —</div><h1>{name || s?.name}</h1></div>
        <div className="pactions">{dirty && <span style={{ alignSelf: 'center' }}><StatusBadge kind="warn">未保存修改</StatusBadge></span>}<button className="btn subtle" onClick={onSim}><Icon id="sim" size={14} className="btn-ico" />运行模拟</button><button className="btn ghost" onClick={saveDraft} disabled={saving}>{saving ? <><Spin />保存中…</> : '保存草稿'}</button><button className="btn" onClick={publish} disabled={saving}>发布策略</button></div>
      </div>
      <div className="banner info" style={{ marginBottom: 16 }}><span className="bd" /><span className="bx">三维权重、结果数量、版本历史、原子发布与回滚均连接真实配置；行为学习仍保持关闭。</span></div>
      <div className="card"><div className="fld-row"><div className="fld"><label className="lbl">策略名称</label><input className="inp" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} /></div><div className="fld"><label className="lbl">版本说明</label><input className="inp" value={changeNote} onChange={(e) => { setChangeNote(e.target.value); setDirty(true); }} /></div></div><div className="fld"><label className="lbl">策略说明</label><input className="inp" value={description} onChange={(e) => { setDescription(e.target.value); setDirty(true); }} /></div></div>
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
          <div className="fld"><label className="lbl">最高展示分</label><input className="inp" type="number" min="1" max="100" value={maxScore} onChange={(e) => { setMaxScore(+e.target.value); setDirty(true); }} /><div className="help">完全匹配时的最高推荐分。</div></div>
          <div className="fld"><label className="lbl">推荐结果数量</label><input className="inp" type="number" value={count} onChange={(e) => { setCount(+e.target.value); setDirty(true); }} /></div>
        </div>
        <div className="fld"><label className="lbl">冷启动兜底<span className="ro">固定</span></label><input className="inp" value="优先返回最近确认标签的已发布作品" disabled readOnly /></div>
      </div>
      <div className="card pad0"><div className="card-h" style={{ padding: '16px 18px' }}><div className="ct">版本历史</div></div><table className="tbl"><thead><tr><th>版本</th><th>状态</th><th>说明</th><th></th></tr></thead><tbody>{(detail?.versions || []).map((version) => <tr key={version.id}><td><VersionBadge v={versionLabel(version.version_no)} /></td><td>{version.status}</td><td>{version.change_note || '—'}</td><td style={{ textAlign: 'right' }}>{version.status === 'archived' && <button className="rowbtn" onClick={() => rollback(version.version_no)}>回滚此内容</button>}</td></tr>)}</tbody></table></div>
      <UnsavedChangesDialog open={leaving} onStay={() => setLeaving(false)} onLeave={() => { setLeaving(false); onBack(); }} />
    </div>
  );
}

/* ── 5. 策略模拟 ── */
export function StrategySimulator({ ctx }) {
  const [running, setRunning] = useState(false);
  const [strategies, setStrategies] = useState([]);
  const [strategyId, setStrategyId] = useState('');
  const [settings, setSettings] = useState(null);
  const [prefs, setPrefs] = useState({ setting: '现代', tone: '温暖治愈', relationship: '相伴成长' });
  const [simulation, setSimulation] = useState(null);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let active = true;
    staffApi.strategies()
      .then((rows) => {
        if (!active) return;
        setStrategies(rows);
        if (rows[0]) setStrategyId(rows[0].id);
      })
      .catch((error) => { if (active) setLoadError(errorMessage(error, '策略列表读取失败。')); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!strategyId) return undefined;
    const timer = setTimeout(async () => {
      try {
        const detail = await staffApi.strategy(strategyId);
        const version = detail.versions.find((item) => item.status === 'draft')
          || detail.versions.find((item) => item.status === 'published');
        setSettings(version?.settings || null);
      } catch (error) { setLoadError(errorMessage(error, '策略详情读取失败。')); }
    }, 0);
    return () => clearTimeout(timer);
  }, [strategyId]);
  async function run() {
    if (!settings) { ctx.push('策略配置尚未加载完成', 'err'); return; }
    setRunning(true); setSimulation(null);
    const weights = settings.weights || {};
    try {
      const result = await staffApi.simulateStrategy(strategyId, {
        setting_weight: weights.setting ?? 15,
        story_tone_weight: weights.story_tone ?? 40,
        relationship_core_weight: weights.relationship_core ?? 45,
        max_score: settings.max_score ?? 96,
        result_limit: settings.result_limit ?? 6,
        setting_tags: prefs.setting ? [prefs.setting] : [],
        story_tone_tags: prefs.tone ? [prefs.tone] : [],
        relationship_core_tags: prefs.relationship ? [prefs.relationship] : [],
      });
      setSimulation(result);
      ctx.push(`策略模拟完成 · ${result.candidate_count} 个匹配候选`, 'ok');
    } catch (error) { ctx.push(errorMessage(error, '策略模拟失败。'), 'err'); }
    finally { setRunning(false); }
  }
  return (
    <div className="page wide fade-in">
      <div className="phead"><div><div className="eyebrow">— Strategy Simulator —</div><h1>策略模拟</h1><p className="lead">发布前预览推荐效果。模拟结果仅用于评估，不会直接影响线上推荐。</p></div></div>
      <div className="banner info" style={{ marginBottom: 16 }}><span className="bd" /><span className="bx">模拟直接使用已发布作品和已确认标签，不写推荐日志、不改变线上配置，也不会调用 AI。</span></div>
      {loadError && <ErrorState desc={loadError} />}
      <div className="filterbar">
        <div className="ff"><label className="lbl">待测策略</label><select className="inp" value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>{strategies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="ff"><label className="lbl">时代设定</label><select className="inp" value={prefs.setting} onChange={(e) => setPrefs((value) => ({ ...value, setting: e.target.value }))}><option value="">不限定</option><option>现代</option><option>古风</option><option>民国</option></select></div>
        <div className="ff"><label className="lbl">故事基调</label><select className="inp" value={prefs.tone} onChange={(e) => setPrefs((value) => ({ ...value, tone: e.target.value }))}><option value="">不限定</option><option>清甜校园</option><option>遗憾青春</option><option>温暖治愈</option><option>浓情曲折</option></select></div>
        <div className="ff"><label className="lbl">关系内核</label><select className="inp" value={prefs.relationship} onChange={(e) => setPrefs((value) => ({ ...value, relationship: e.target.value }))}><option value="">不限定</option><option>暗恋未明</option><option>久别重逢</option><option>相伴成长</option><option>命运拉扯</option></select></div>
        <div className="fspacer" />
        <button className="btn" onClick={run} disabled={running}>{running ? <><Spin />运行中…</> : <><Icon id="sim" size={14} className="btn-ico" />运行模拟</>}</button>
      </div>
      {running ? <div className="card"><LoadingState rows={4} /></div>
        : !simulation ? <EmptyState icon="sim" title="尚未运行模拟" desc="选择偏好后运行，可查看真实候选作品的匹配分和命中标签。" />
          : <div className="card pad0"><div className="card-h" style={{ padding: '16px 18px' }}><div className="ct">模拟结果 · {simulation.candidate_count} 个匹配候选</div></div>{simulation.results.length === 0 ? <EmptyState title="没有匹配作品" desc="可更换偏好组合后重试。" /> : <table className="tbl"><thead><tr><th>作品</th><th>作者</th><th>得分</th><th>命中标签</th></tr></thead><tbody>{simulation.results.map((item) => <tr key={item.book_id}><td className="t-name">{item.title}</td><td>{item.author}</td><td className="t-num">{item.score}</td><td className="t-sub">{Object.values(item.matched_tags || {}).flat().join(' · ') || '—'}</td></tr>)}</tbody></table>}</div>}
    </div>
  );
}

/* ── 6. 编辑配置日志 ── */
export function EditorialAuditLogs({ ctx }) {
  const [detail, setDetail] = useState(null);
  const [logs, setLogs] = useState([]);
  const [filters, setFilters] = useState(INITIAL_EDITORIAL_LOG_FILTERS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const loadLogs = useCallback(async (nextFilters = INITIAL_EDITORIAL_LOG_FILTERS) => {
    setLoading(true); setLoadError('');
    const params = {
      q: nextFilters.q,
      action_contains: nextFilters.action_contains,
      ...(nextFilters.module === 'review'
        ? { domain: 'review' }
        : { action_prefix: nextFilters.module }),
    };
    try { setLogs((await staffApi.editorialLogs(params)).map(toUiEditorialLog)); }
    catch (error) { setLoadError(errorMessage(error, '编辑配置日志读取失败。')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => loadLogs(INITIAL_EDITORIAL_LOG_FILTERS), 0);
    return () => clearTimeout(timer);
  }, [loadLogs]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function resetFilters() {
    setFilters(INITIAL_EDITORIAL_LOG_FILTERS);
    loadLogs(INITIAL_EDITORIAL_LOG_FILTERS);
  }

  function exportLogs() {
    if (!logs.length) { ctx.push('当前没有可导出的编辑日志。', 'info'); return; }
    downloadCsv(`qingyue-editorial-logs-${new Date().toISOString().slice(0, 10)}.csv`, [
      { key: 't', label: '时间' }, { key: 'who', label: '操作人' },
      { key: 'mod', label: '模块' }, { key: 'act', label: '操作' },
      { key: 'ver', label: '版本或资源' }, { key: 'note', label: '变更说明' },
      { key: 'result', label: '结果' },
    ], logs);
    ctx.push(`已导出 ${logs.length} 条编辑日志。`, 'ok');
  }
  return (
    <div className="page wide fade-in">
      <div className="phead"><div><div className="eyebrow">— Editorial Audit —</div><h1>编辑配置日志</h1><p className="lead">Prompt、标签与推荐策略的全部配置操作留痕，含操作人、时间与版本。</p></div><div className="pactions"><button className="btn ghost" onClick={exportLogs}><Icon id="download" size={14} className="btn-ico" />导出记录</button></div></div>
      <div className="filterbar">
        <div className="ff"><label className="lbl">模块</label><select className="inp" value={filters.module} onChange={(e) => updateFilter('module', e.target.value)}><option value="">全部</option><option value="prompt">Prompt</option><option value="vocabulary">标签词表</option><option value="strategy">推荐策略</option><option value="review">审稿</option></select></div>
        <div className="ff"><label className="lbl">操作</label><select className="inp" value={filters.action_contains} onChange={(e) => updateFilter('action_contains', e.target.value)}><option value="">全部</option><option value="publish">发布</option><option value="rollback">回滚</option><option value="test">测试</option><option value="save">保存</option><option value="update">修改</option></select></div>
        <div className="ff"><label className="lbl">关键词</label><input className="inp" value={filters.q} onChange={(e) => updateFilter('q', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') loadLogs(filters); }} placeholder="搜索版本 / 说明 / 操作人" /></div>
        <div className="fspacer" /><button className="btn subtle" onClick={() => loadLogs(filters)}>筛选</button><button className="btn ghost" onClick={resetFilters}>重置</button>
      </div>
      <div className="card pad0">
        {loading && <LoadingState rows={5} />}
        {!loading && loadError && <ErrorState desc={loadError} onRetry={loadLogs} />}
        {!loading && !loadError && logs.length === 0 && <EmptyState title="暂无编辑配置日志" desc="发布或修改配置后会在这里留下记录。" />}
        {!loading && !loadError && logs.length > 0 && <table className="tbl"><thead><tr><th>时间</th><th>操作人</th><th>模块</th><th>操作</th><th>版本</th><th>变更说明</th><th>结果</th><th style={{ textAlign: 'right' }}></th></tr></thead><tbody>
          {logs.map((l) => <tr key={l.id}><td className="t-mono">{l.t}</td><td>{l.who}</td><td>{l.mod}</td><td>{l.act}</td><td className="t-sub">{l.ver}</td><td style={{ maxWidth: 180 }}>{l.note}</td><td>{l.result}</td><td style={{ textAlign: 'right' }}><button className="rowbtn" onClick={() => setDetail(l)}>详情</button></td></tr>)}
        </tbody></table>}
      </div>
      {detail && <div className="scrim" onClick={() => setDetail(null)}><div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><div className="mi info"><Icon id="doc" size={19} /></div><div><div className="mt">编辑日志详情</div><div className="md">{detail.t} · {detail.mod}</div></div></div>
        <div className="modal-body"><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div><div className="lbl">操作人</div><div>{detail.who}</div></div><div><div className="lbl">结果</div><div>{detail.result}</div></div>
          <div><div className="lbl">动作标识</div><div className="t-mono">{detail.raw.action}</div></div><div><div className="lbl">资源</div><div className="t-mono">{detail.raw.resource_type}{detail.raw.resource_id ? ` · ${detail.raw.resource_id}` : ''}</div></div>
          <div style={{ gridColumn: '1 / -1' }}><div className="lbl">变更说明</div><div>{detail.note}</div></div>
          {(detail.raw.before_data || detail.raw.after_data) && <div style={{ gridColumn: '1 / -1' }}><div className="lbl">变更内容</div><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0, fontSize: 12 }}>{JSON.stringify({ before: detail.raw.before_data, after: detail.raw.after_data }, null, 2)}</pre></div>}
        </div><div className="impact" style={{ marginTop: 14 }}><div className="il">隐私保护</div>日志只记录配置元数据，不记录 API 密钥、登录凭据或稿件正文。</div></div>
        <div className="modal-foot"><button className="btn ghost" onClick={() => setDetail(null)}>关闭</button></div>
      </div></div>}
    </div>
  );
}

/* 接口状态：
 *   已接入：概览、配置详情、草稿、发布、回滚、词条新增/改名/启停、
 *           Prompt 试运行、策略模拟、版本历史与编辑审计日志。
 *   待补：新增配置对象。
 */
