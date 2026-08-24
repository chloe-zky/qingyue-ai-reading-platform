// screens.jsx — 手机端各角色屏幕（平台管理员 5 / 编辑部负责人 5 / 审稿编辑 2）。
// DOM / 类名 / 内联样式逐字移植自 prototype-admin/mobile-screens.jsx。
//
// 数据源：与桌面端一致，走 Codex 的 staff/api.js 真实接口，不用设计稿的 MOCK。
// 原型里所有「假成功」的动作（AI 连通测试、Prompt 发布、词表编辑、策略模拟）
// 后端尚无端点，一律明确提示未实现，不伪造结果 —— 与桌面端的处理保持一致。
//
// 角色横幅 rolehero 原型写死 ACCOUNTS[role]，这里改用真实登录身份。

import { useCallback, useEffect, useState } from 'react';
import Icon from '../shared/Icon';
import { ROLES } from '../shared/constants';
import { useStaffAuth } from '../../auth/staffAuth';
import {
  staffApi, errorMessage, formatDateTime, versionLabel,
  toUiStaff, toUiTechnicalLog, toUiEditorialLog, toUiPrompt, toUiStrategy,
  toUiSubmission, toUiReviewLog,
} from '../api';
import { MSpin, MBadge, MRoleBadge, MVer, DeskCue, MEmpty, MLoading, MError } from './core';
import { M_STAFF, M_PROMPT } from './dicts';

/** 角色横幅：取真实登录身份，背景按角色主题色。 */
function RoleHero({ role }) {
  const { staff } = useStaffAuth();
  const initial = (staff?.display_name || staff?.email || '?').trim().charAt(0);
  const en = ROLES[role].en;
  // 审稿编辑用绿系（与桌面 rolebadge.review 同源），其余用主题 --rail。
  const style = role === 'review' ? { background: 'linear-gradient(150deg,#1B3B33,#255049)' } : undefined;
  return (
    <div className="rolehero" style={style}>
      <div className="rh-lines" />
      <div className="rh-k">当前角色 · {en}</div>
      <div className="rh-n"><span className="seal">{initial}</span>{ROLES[role].name}</div>
      <div className="rh-e">{staff?.email}</div>
    </div>
  );
}

/* ══════════ 平台管理员（蓝）══════════ */
export function MAdminHome({ ctx }) {
  const [o, setO] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [llm, accounts, logs] = await Promise.all([staffApi.llmStatus(), staffApi.staff(), staffApi.platformLogs()]);
      const items = accounts.staff || [];
      const recent = logs || [];
      setO({
        model: llm.model_name || '—',
        configured: Boolean(llm.configured),
        recentErrors: recent.filter((x) => x.result === 'failure').length,
        staffTotal: items.length,
        staffDisabled: items.filter((x) => x.status === 'disabled').length,
        lastChange: recent[0] ? `${formatDateTime(recent[0].created_at)} · ${recent[0].summary || recent[0].action}` : '暂无配置变更',
      });
    } catch (error) { setLoadError(errorMessage(error, '技术概览读取失败。')); }
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  async function test() {
    setTesting(true);
    try {
      const llm = await staffApi.llmStatus();
      ctx.push(llm.configured ? 'AI 配置完整；真实连通测试端点尚未实现。' : 'AI 服务尚未完成配置。', llm.configured ? 'info' : 'err');
    } catch (error) { ctx.push(errorMessage(error), 'err'); }
    finally { setTesting(false); }
  }

  return (
    <div className="scroll fade-in"><div className="pad">
      <RoleHero role="admin" />
      {loadError && <MError desc={loadError} onRetry={load} />}
      {!loadError && !o && <MLoading rows={3} />}
      {!loadError && o && <>
        <div className="kpi-grid">
          <div className="kpi"><div className="kk"><Icon id="bolt" size={13} />AI 服务</div><div className="kv badgey"><MBadge kind={o.configured ? 'ok' : 'warn'}>{o.configured ? '已配置' : '未配置'}</MBadge></div><div className="kmeta">{o.model}</div></div>
          <div className="kpi"><div className="kk"><Icon id="db" size={13} />Supabase</div><div className="kv badgey"><MBadge kind="ok">已连接</MBadge></div><div className="kmeta">员工数据读取正常</div></div>
          <div className="kpi"><div className="kk"><Icon id="warn" size={13} />24h 错误</div><div className="kv">{o.recentErrors}<span className="u">条</span></div><div className="kmeta down">需关注</div></div>
          <div className="kpi"><div className="kk"><Icon id="staff" size={13} />员工账号</div><div className="kv">{o.staffTotal}<span className="u">个</span></div><div className="kmeta">{o.staffDisabled} 个已禁用</div></div>
        </div>
        <div className="card"><div className="card-h"><div className="ct">快捷操作</div></div>
          <div className="btnrow" style={{ marginBottom: 10 }}><button className="btn subtle sm" style={{ flex: 1 }} onClick={() => ctx.go('llm')}><Icon id="llm" size={14} className="btn-ico" />AI 配置</button><button className="btn ghost sm" style={{ flex: 1 }} onClick={test} disabled={testing}>{testing ? <><MSpin />测试中…</> : <><Icon id="bolt" size={14} className="btn-ico" />测试连接</>}</button></div>
          <div className="btnrow"><button className="btn ghost sm" style={{ flex: 1 }} onClick={() => ctx.go('health')}><Icon id="health" size={14} className="btn-ico" />系统状态</button><button className="btn ghost sm" style={{ flex: 1 }} onClick={() => ctx.go('logs')}><Icon id="logs" size={14} className="btn-ico" />技术日志</button></div>
        </div>
        <div className="card"><div className="card-h"><div className="ct">最近动态</div></div>
          <div className="banner info"><span className="bd" /><span className="bx"><b>最近配置变更</b><br />{o.lastChange}</span></div>
        </div>
      </>}
    </div></div>
  );
}

export function MAdminLLM({ ctx }) {
  const [c, setC] = useState(null);
  const [editKey, setEditKey] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [show, setShow] = useState(false);
  const [masked, setMasked] = useState('');
  const [model, setModel] = useState('');
  const [base, setBase] = useState('');
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const s = await staffApi.llmStatus();
      setC(s); setModel(s.model_name || ''); setBase(s.api_base || '');
      setMasked(s.masked_key === '***' ? '' : s.masked_key);
    } catch (error) { setLoadError(errorMessage(error, 'AI 配置读取失败。')); }
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  const dirty = c && (model !== (c.model_name || '') || base !== (c.api_base || '') || (editKey && newKey.trim()));

  function runTest() {
    setBanner({ kind: 'info', text: '后端尚未提供上游 AI 连通测试端点；此按钮不会伪造测试结果。' });
    ctx.push('AI 连通测试端点尚未实现', 'info');
  }
  async function save() {
    const r = await ctx.confirm({
      tone: 'warn', title: '保存并启用新配置？', desc: '启用后所有依赖 AI 的功能立即使用新配置。',
      impact: <>· 立即对全站生效<br />· 记录操作人与时间<br />· 原密钥{newKey.trim() ? '将被替换' : '保持不变'}</>,
      confirmText: '保存并启用',
    });
    if (!r.ok) return;
    setSaving(true); setBanner(null);
    try {
      await staffApi.saveLlm({ api_base: base, model_name: model, api_key: newKey.trim(), api_type: c.api_type || 'openai_compatible' });
      await load();
      setEditKey(false); setNewKey('');
      setBanner({ kind: 'ok', text: '配置已保存并启用，密钥仅以脱敏形式保存。' });
      ctx.push('配置已保存并启用', 'ok');
    } catch (error) {
      setBanner({ kind: 'err', text: errorMessage(error, '配置保存失败。') });
      ctx.push(errorMessage(error), 'err');
    } finally { setSaving(false); }
  }

  if (loadError) return <div className="scroll fade-in"><div className="pad"><MError desc={loadError} onRetry={load} /></div></div>;
  if (!c) return <div className="scroll fade-in"><div className="pad"><MLoading rows={3} /></div></div>;

  return (
    <div className="scroll fade-in"><div className="pad">
      <p className="lead-p">配置作品智能能力依赖的大模型服务。密钥仅以脱敏形式保存，完整密钥永不回显。</p>
      <div style={{ marginBottom: 14 }}>{c.configured ? <MBadge kind="ok">已配置</MBadge> : <MBadge kind="mute">未配置</MBadge>}{dirty && <span style={{ marginLeft: 8 }}><MBadge kind="warn">未保存修改</MBadge></span>}</div>
      <div className="card">
        <div className="card-h"><div className="ct">连接参数</div></div>
        <div className="fld"><label className="lbl">API 类型<span className="ro">只读</span></label><input className="inp mono" value={c.api_type || 'openai_compatible'} disabled readOnly /></div>
        <div className="fld"><label className="lbl">模型名称<span className="req">必填</span></label><input className="inp mono" value={model} onChange={(e) => setModel(e.target.value)} /></div>
        <div className="fld"><label className="lbl">API Base URL<span className="req">必填</span></label><input className="inp mono" value={base} onChange={(e) => setBase(e.target.value)} inputMode="url" /><div className="help">HTTP / HTTPS 地址。</div></div>
        <div className="fld"><label className="lbl"><Icon id="key" size={12} />API Key</label>
          {!editKey ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><span className="mono" style={{ fontSize: 13, color: 'var(--ink-2)' }}>{masked || '— 未设置 —'}</span><button className="btn ghost sm" onClick={() => setEditKey(true)}><Icon id="key" size={13} className="btn-ico" />更新密钥</button></div>
            : <div className="inp-wrap"><input className="inp mono" type={show ? 'text' : 'password'} value={newKey} placeholder="留空表示不修改原密钥" style={{ paddingRight: 58 }} onChange={(e) => setNewKey(e.target.value)} /><button className="reveal" onClick={() => setShow((s) => !s)}>{show ? '隐藏' : '显示'}</button></div>}
          <div className="help note" style={{ color: 'var(--warn)' }}>完整密钥不会被展示，仅显示脱敏值。</div>
        </div>
      </div>
      <div className="card">
        <div className="card-h"><div className="ct">连接测试</div></div>
        <button className="btn ghost" onClick={runTest}><Icon id="plug" size={14} className="btn-ico" />测试连接</button>
      </div>
      {banner && <div className={'banner ' + banner.kind} style={{ marginBottom: 14 }}><span className="bd" /><span className="bx">{banner.text}</span></div>}
      <button className="btn" onClick={save} disabled={saving || !dirty}>{saving ? <><MSpin />保存中…</> : '保存并启用'}</button>
      {!dirty && <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--ink-3)', marginTop: 10 }}>修改任意参数后可保存</div>}
    </div></div>
  );
}

export function MAdminStaff({ ctx }) {
  const [staff, setStaff] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { setStaff(((await staffApi.staff()).staff || []).map(toUiStaff)); }
    catch (error) { setLoadError(errorMessage(error, '员工账号读取失败。')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  async function setStatus(s, status, label) {
    try {
      await staffApi.updateStaff(s.id, { status });
      await load(); setSheet(null);
      ctx.push(`${label} ${s.name}`, 'ok');
    } catch (error) { ctx.push(errorMessage(error), 'err'); }
  }
  async function disable(s) {
    const r = await ctx.confirm({
      tone: 'danger', title: `禁用 ${s.name}？`, desc: '禁用后该员工立即无法登录。',
      impact: <>· 强制结束其当前会话<br />· 可随时恢复</>, confirmText: '禁用账号',
    });
    if (!r.ok) return;
    await setStatus(s, 'disabled', '已禁用');
  }

  return (
    <div className="scroll fade-in"><div className="pad">
      <p className="lead-p">管理内部员工账号状态。角色分配等复杂操作建议在桌面端完成。</p>
      <DeskCue><b>邀请员工 / 修改角色</b> 涉及权限分配，请在桌面端「员工账号」中完成。手机端可快速启用或禁用账号。</DeskCue>
      <div className="card pad0" style={{ marginTop: 14 }}>
        {loading && <MLoading rows={3} />}
        {!loading && loadError && <MError desc={loadError} onRetry={load} />}
        {!loading && !loadError && staff.length === 0 && <MEmpty title="暂无员工账号" desc="尚未创建任何内部账号。" />}
        {!loading && !loadError && staff.map((s) => <button key={s.id} className="lrow" onClick={() => setSheet(s)}>
          <div className="lr-ico" style={{ fontFamily: 'var(--font-display)', fontSize: 14 }}>{(s.name || '?').charAt(0)}</div>
          <div className="lr-t"><div className="lr-n">{s.name}</div><div className="lr-s mono">{s.email}</div></div>
          <div className="lr-meta"><MRoleBadge role={s.role} /><MBadge kind={M_STAFF[s.status][0]}>{M_STAFF[s.status][1]}</MBadge></div>
        </button>)}
      </div>
      {sheet && <div className="scrim" onClick={() => setSheet(null)}><div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="sheet-h"><div className="mi info" style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>{(sheet.name || '?').charAt(0)}</div><div><div className="mt">{sheet.name}</div><div className="md mono">{sheet.email}</div></div></div>
        <div className="sheet-body">
          <div className="ro-list"><div className="rr"><span className="rr-k">角色</span><span className="rr-v"><MRoleBadge role={sheet.role} /></span></div><div className="rr"><span className="rr-k">状态</span><span className="rr-v"><MBadge kind={M_STAFF[sheet.status][0]}>{M_STAFF[sheet.status][1]}</MBadge></span></div><div className="rr"><span className="rr-k">最近登录</span><span className="rr-v mono">{sheet.last}</span></div></div>
        </div>
        <div className="sheet-foot">
          {sheet.status === 'disabled' ? <button className="btn" onClick={() => setStatus(sheet, 'active', '已恢复')}>恢复账号</button>
            : <><button className="btn ghost" onClick={() => ctx.push('请在桌面端修改角色', 'info')}>修改角色</button><button className="btn danger" onClick={() => disable(sheet)}>禁用账号</button></>}
        </div>
      </div></div>}
    </div></div>
  );
}

export function MAdminHealth({ ctx }) {
  const [checking, setChecking] = useState(false);
  const [at, setAt] = useState('尚未检查');
  const [health, setHealth] = useState([
    { id: 'api', name: '后端 API', icon: 'plug', status: 'warn', ms: null, note: '等待检查' },
    { id: 'db', name: 'Supabase', icon: 'db', status: 'warn', ms: null, note: '等待检查' },
    { id: 'ai', name: 'AI 服务', icon: 'bolt', status: 'warn', ms: null, note: '仅检查配置完整性' },
    { id: 'storage', name: '文件存储', icon: 'cloud', status: 'warn', ms: null, note: '后端尚未提供存储健康探针' },
  ]);

  const check = useCallback(async (notify = true) => {
    setChecking(true);
    const started = performance.now();
    const [apiR, dbR, llmR] = await Promise.allSettled([staffApi.health(), staffApi.staff(), staffApi.llmStatus()]);
    const elapsed = Math.max(1, Math.round(performance.now() - started));
    const llm = llmR.status === 'fulfilled' ? llmR.value : null;
    setHealth([
      { id: 'api', name: '后端 API', icon: 'plug', status: apiR.status === 'fulfilled' ? 'ok' : 'err', ms: elapsed, note: apiR.status === 'fulfilled' ? '健康接口响应正常' : errorMessage(apiR.reason) },
      { id: 'db', name: 'Supabase', icon: 'db', status: dbR.status === 'fulfilled' ? 'ok' : 'err', ms: elapsed, note: dbR.status === 'fulfilled' ? '员工数据读取正常' : errorMessage(dbR.reason) },
      { id: 'ai', name: 'AI 服务', icon: 'bolt', status: llm?.configured ? 'warn' : 'err', ms: null, note: llm?.configured ? `${llm.model_name || '模型'} 已配置，未做上游连通测试` : 'AI 服务尚未完整配置' },
      { id: 'storage', name: '文件存储', icon: 'cloud', status: 'warn', ms: null, note: '后端尚未提供存储健康探针' },
    ]);
    setAt('刚刚'); setChecking(false);
    if (notify) ctx.push('已完成可用探针检查；未提供探针的项目保持“注意”。', 'info');
  }, [ctx]);
  useEffect(() => { const t = setTimeout(() => check(false), 0); return () => clearTimeout(t); }, [check]);

  return (
    <div className="scroll fade-in"><div className="pad">
      <p className="lead-p">各核心依赖实时健康检查。最近检查：{at}。</p>
      <button className="btn ghost" onClick={() => check()} disabled={checking} style={{ marginBottom: 14 }}>{checking ? <><MSpin />检查中…</> : <><Icon id="refresh" size={14} className="btn-ico" />立即检查</>}</button>
      {health.map((h) => <div className="card" key={h.id} style={{ marginBottom: 11 }}><div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="lr-ico"><Icon id={h.icon} size={18} /></div>
        <div style={{ flex: 1 }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14.5 }}>{h.name}</div><div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{h.note}</div></div>
        <div style={{ textAlign: 'right' }}><MBadge kind={h.status === 'ok' ? 'ok' : (h.status === 'warn' ? 'warn' : 'err')}>{h.status === 'ok' ? '正常' : (h.status === 'warn' ? '注意' : '异常')}</MBadge><div className="numf" style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 5 }}>{h.ms != null ? `${h.ms} ms` : '—'}</div></div>
      </div></div>)}
    </div></div>
  );
}

export function MAdminLogs() {
  const [logs, setLogs] = useState([]);
  const [detail, setDetail] = useState(null);
  const [filter, setFilter] = useState('全部');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const LVL = { info: ['info', 'INFO'], warn: ['warn', 'WARN'], error: ['err', 'ERROR'] };

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { setLogs((await staffApi.platformLogs()).map(toUiTechnicalLog)); }
    catch (error) { setLoadError(errorMessage(error, '技术日志读取失败。')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  const shown = filter === '全部' ? logs : logs.filter((l) => LVL[l.lvl]?.[1] === filter);

  return (
    <div className="scroll fade-in"><div className="pad">
      <p className="lead-p">系统与安全事件审计记录。日志不含完整密钥、Token、密码或稿件正文。</p>
      <div className="seg-ctl" style={{ marginBottom: 14 }}>
        {['全部', 'INFO', 'WARN', 'ERROR'].map((k) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{k}</button>)}
      </div>
      <div className="card pad0">
        {loading && <MLoading rows={3} />}
        {!loading && loadError && <MError desc={loadError} onRetry={load} />}
        {!loading && !loadError && shown.length === 0 && <MEmpty title="暂无日志" desc="该筛选条件下没有记录。" />}
        {!loading && !loadError && shown.map((l, i) => <button key={i} className="lrow" onClick={() => setDetail(l)}>
          <div className="lr-t"><div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}><MBadge kind={LVL[l.lvl][0]}>{LVL[l.lvl][1]}</MBadge><span className="lr-s" style={{ margin: 0 }}>{l.mod}</span></div><div className="lr-n" style={{ fontSize: 13.5 }}>{l.act}</div><div className="lr-s mono">{l.t} · {l.who}</div></div>
          <span className="chev">›</span>
        </button>)}
      </div>
      {detail && <div className="scrim" onClick={() => setDetail(null)}><div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" /><div className="sheet-h"><div className="mi info"><Icon id="doc" size={19} /></div><div><div className="mt">日志详情</div><div className="md">{detail.t} · {detail.mod}</div></div></div>
        <div className="sheet-body"><div className="ro-list"><div className="rr"><span className="rr-k">操作人</span><span className="rr-v">{detail.who}</span></div><div className="rr"><span className="rr-k">操作摘要</span><span className="rr-v">{detail.act}</span></div><div className="rr"><span className="rr-k">结果</span><span className="rr-v">{detail.result}</span></div></div>
          <div className="impact" style={{ marginTop: 14 }}><div className="il">已脱敏</div>日志不记录完整 API Key、Token、密码及稿件正文。</div></div>
        <div className="sheet-foot"><button className="btn ghost" onClick={() => setDetail(null)}>关闭</button></div>
      </div></div>}
    </div></div>
  );
}

/* ══════════ 编辑部负责人（文艺）══════════ */
export function MLeadHome({ ctx }) {
  const [o, setO] = useState(null);
  const [loadError, setLoadError] = useState('');
  const load = useCallback(async () => {
    setLoadError('');
    try { setO(await staffApi.editorialOverview()); }
    catch (error) { setLoadError(errorMessage(error, '编辑策略概览读取失败。')); }
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  return (
    <div className="scroll fade-in"><div className="pad">
      <RoleHero role="lead" />
      {loadError && <MError desc={loadError} onRetry={load} />}
      {!loadError && !o && <MLoading rows={3} />}
      {!loadError && o && <>
        <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div className="kpi" style={{ padding: '13px 12px' }}><div className="kk" style={{ fontSize: 10.5 }}>Prompt</div><div className="kv" style={{ fontSize: 22 }}>{versionLabel(o.prompt_version)}</div><div className="kmeta">{o.draft_count} 草稿</div></div>
          <div className="kpi" style={{ padding: '13px 12px' }}><div className="kk" style={{ fontSize: 10.5 }}>词表</div><div className="kv" style={{ fontSize: 22 }}>{versionLabel(o.tag_vocabulary_version)}</div><div className="kmeta">当前生效</div></div>
          <div className="kpi" style={{ padding: '13px 12px' }}><div className="kk" style={{ fontSize: 10.5 }}>推荐</div><div className="kv" style={{ fontSize: 22 }}>{versionLabel(o.strategy_version)}</div><div className="kmeta">当前生效</div></div>
        </div>
        <DeskCue><b>Prompt、词表、推荐策略的编辑与发布</b>为高风险内容操作，请在桌面端完成。手机端可查看当前生效版本并查看日志。</DeskCue>
        <div className="card" style={{ marginTop: 14 }}><div className="card-h"><div className="ct">查看 / 轻操作</div></div>
          <div className="card pad0" style={{ margin: 0, border: 0 }}>
            <button className="lrow" style={{ padding: '12px 0' }} onClick={() => ctx.go('prompt')}><div className="lr-ico"><Icon id="prompt" size={17} /></div><div className="lr-t"><div className="lr-n">Prompt 管理</div><div className="lr-s">查看版本 · 编辑请去桌面端</div></div><span className="chev">›</span></button>
            <button className="lrow" style={{ padding: '12px 0' }} onClick={() => ctx.go('tags')}><div className="lr-ico"><Icon id="tags" size={17} /></div><div className="lr-t"><div className="lr-n">标签词表</div><div className="lr-s">浏览版本</div></div><span className="chev">›</span></button>
            <button className="lrow" style={{ padding: '12px 0' }} onClick={() => ctx.go('reco')}><div className="lr-ico"><Icon id="reco" size={17} /></div><div className="lr-t"><div className="lr-n">推荐策略</div><div className="lr-s">查看当前生效策略</div></div><span className="chev">›</span></button>
          </div>
        </div>
        <div className="card"><div className="card-h"><div className="ct">最近策略变更</div></div><div className="banner info"><span className="bd" /><span className="bx">最近一次发布：<b>{formatDateTime(o.last_published_at)}</b>。详细变更请查看编辑配置日志。</span></div></div>
      </>}
    </div></div>
  );
}

export function MLeadPrompt({ ctx }) {
  const [prompts, setPrompts] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { setPrompts((await staffApi.prompts()).map(toUiPrompt)); }
    catch (error) { setLoadError(errorMessage(error, 'Prompt 列表读取失败。')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  return (
    <div className="scroll fade-in"><div className="pad">
      <p className="lead-p">各场景提示词及版本。手机端为只读查看，编辑与发布请在桌面端完成。</p>
      <div className="card pad0">
        {loading && <MLoading rows={3} />}
        {!loading && loadError && <MError desc={loadError} onRetry={load} />}
        {!loading && !loadError && prompts.length === 0 && <MEmpty title="暂无 Prompt" desc="数据库中尚未创建 Prompt 配置。" />}
        {!loading && !loadError && prompts.map((p) => <button key={p.id} className="lrow" onClick={() => setDetail(p)}>
          <div className="lr-t"><div className="lr-n">{p.name}</div><div className="lr-s">{p.scene} · {p.by} {p.at}</div></div>
          <div className="lr-meta"><MBadge kind={(M_PROMPT[p.status] || M_PROMPT.draft)[0]}>{(M_PROMPT[p.status] || M_PROMPT.draft)[1]}</MBadge><span style={{ display: 'flex', gap: 5 }}><MVer v={p.live} />{p.draft && <MVer v={p.draft} label="草稿" />}</span></div>
        </button>)}
      </div>
      {detail && <div className="scrim" onClick={() => setDetail(null)}><div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" /><div className="sheet-h"><div className="mi info"><Icon id="prompt" size={19} /></div><div><div className="mt">{detail.name}</div><div className="md">{detail.scene}</div></div></div>
        <div className="sheet-body">
          <div className="ro-list"><div className="rr"><span className="rr-k">生效版本</span><span className="rr-v"><MVer v={detail.live} /></span></div><div className="rr"><span className="rr-k">草稿</span><span className="rr-v">{detail.draft ? <MVer v={detail.draft} label="草稿" /> : '—'}</span></div><div className="rr"><span className="rr-k">状态</span><span className="rr-v"><MBadge kind={(M_PROMPT[detail.status] || M_PROMPT.draft)[0]}>{(M_PROMPT[detail.status] || M_PROMPT.draft)[1]}</MBadge></span></div></div>
          <div className="deskcue" style={{ marginTop: 14 }}><div className="dc-ico"><Icon id="overview" size={15} /></div><div>编辑草稿、版本对比与发布请在桌面端完成，以确保变更说明与审计留痕完整。</div></div>
        </div>
        <div className="sheet-foot"><button className="btn ghost" onClick={() => setDetail(null)}>关闭</button><button className="btn" onClick={() => ctx.push('请在桌面端编辑', 'info')}>桌面端编辑</button></div>
      </div></div>}
    </div></div>
  );
}

export function MLeadTags() {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { setVersions(await staffApi.vocabularyVersions()); }
    catch (error) { setLoadError(errorMessage(error, '词表版本读取失败。')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  return (
    <div className="scroll fade-in"><div className="pad">
      {/* 原型此屏是「分类 chips + 词条列表」。后端目前只提供词表版本列表，
          分类与词条读取接口尚未实现，故此处按版本渲染同一套 lrow 结构。 */}
      <p className="lead-p">AI 打标与推荐依据的标签词表版本（只读浏览）。</p>
      <div className="banner info" style={{ marginBottom: 14 }}><span className="bd" /><span className="bx">已接入真实词表版本；分类与词条读取接口尚未实现。</span></div>
      <div className="card pad0">
        {loading && <MLoading rows={3} />}
        {!loading && loadError && <MError desc={loadError} onRetry={load} />}
        {!loading && !loadError && versions.length === 0 && <MEmpty title="暂无词表版本" desc="数据库中尚未创建标签词表版本。" />}
        {!loading && !loadError && versions.map((v) => <div key={v.id} className="lrow" style={{ cursor: 'default' }}>
          <div className="lr-t"><div className="lr-n">词表 {versionLabel(v.version_no)}</div><div className="lr-s mono">{v.category_count} 个分类 · {formatDateTime(v.published_at)}</div></div>
          <MBadge kind={v.status === 'published' ? 'ok' : (v.status === 'draft' ? 'warn' : 'mute')}>{v.status === 'published' ? '已发布' : (v.status === 'draft' ? '草稿' : '已归档')}</MBadge>
        </div>)}
      </div>
      <DeskCue>新增、停用、合并标签及发布词表版本请在桌面端完成。</DeskCue>
    </div></div>
  );
}

export function MLeadReco({ ctx }) {
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { setStrategies((await staffApi.strategies()).map(toUiStrategy)); }
    catch (error) { setLoadError(errorMessage(error, '推荐策略读取失败。')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  const live = strategies.find((s) => s.status === 'published') || strategies[0];
  // 权重取自当前生效策略版本的 settings；后端未返回时不编造数值。
  const weights = live?.weights ? Object.entries(live.weights) : [];

  return (
    <div className="scroll fade-in"><div className="pad">
      <p className="lead-p">当前生效策略 {live ? <MVer v={live.ver} /> : '—'} {live?.name || ''}。权重为只读，调整请去桌面端。</p>
      {loading && <MLoading rows={3} />}
      {!loading && loadError && <MError desc={loadError} onRetry={load} />}
      {!loading && !loadError && !live && <MEmpty title="暂无推荐策略" desc="数据库中尚未创建推荐策略。" />}
      {!loading && !loadError && live && <>
        <div className="card"><div className="card-h"><div className="ct">权重配置（只读）</div></div>
          {weights.length ? weights.map(([l, v]) => <div className="wbar" key={l}><span className="wb-l">{l}</span><span className="wb-track"><span className="wb-fill" style={{ width: Number(v) + '%' }} /></span><span className="wb-v">{v}%</span></div>)
            : <div className="card-hint" style={{ margin: 0 }}>当前策略版本未返回权重明细。</div>}
        </div>
        <div className="card"><div className="card-h"><div className="ct">策略模拟</div></div>
          <div className="card-hint">模拟结果仅用于评估，不会影响线上推荐。</div>
          <button className="btn subtle" onClick={() => ctx.push('策略模拟接口尚未实现', 'info')}><Icon id="sim" size={14} className="btn-ico" />运行模拟</button>
        </div>
      </>}
      <DeskCue>调整权重、阈值与发布策略请在桌面端「推荐策略」中完成。</DeskCue>
    </div></div>
  );
}

export function MLeadLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { setLogs((await staffApi.editorialLogs()).map(toUiEditorialLog)); }
    catch (error) { setLoadError(errorMessage(error, '编辑配置日志读取失败。')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  return (
    <div className="scroll fade-in"><div className="pad">
      <p className="lead-p">Prompt、标签与推荐策略的配置操作留痕。</p>
      <div className="card pad0">
        {loading && <MLoading rows={3} />}
        {!loading && loadError && <MError desc={loadError} onRetry={load} />}
        {!loading && !loadError && logs.length === 0 && <MEmpty title="暂无配置记录" desc="尚未产生编辑配置操作。" />}
        {!loading && !loadError && logs.map((l, i) => <div key={i} className="lrow" style={{ cursor: 'default' }}>
          <div className="lr-t"><div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}><MBadge kind="mute">{l.mod}</MBadge><span className="lr-s" style={{ margin: 0 }}>{l.act}</span></div><div className="lr-n" style={{ fontSize: 13.5 }}>{l.ver}</div><div className="lr-s">{l.note} · {l.who} {l.t}</div></div>
        </div>)}
      </div>
    </div></div>
  );
}

/* ══════════ 审稿编辑 ══════════ */
export function MReviewHome({ ctx }) {
  const [queue, setQueue] = useState([]);
  const [config, setConfig] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async (notify = false) => {
    setLoadError('');
    const [subs, summary] = await Promise.all([staffApi.submissions(), staffApi.reviewConfigSummary()]);
    setQueue(subs.map(toUiSubmission));
    setConfig(summary);
    if (notify) ctx.push('待审列表已刷新', 'ok');
  }, [ctx]);
  useEffect(() => {
    const t = setTimeout(() => {
      load().catch((e) => setLoadError(errorMessage(e, '审稿工作台读取失败。'))).finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    try { await load(true); }
    catch (error) { setLoadError(errorMessage(error)); ctx.push(errorMessage(error), 'err'); }
    finally { setRefreshing(false); }
  }

  return (
    <div className="scroll fade-in"><div className="pad">
      <RoleHero role="review" />
      <div className="card"><div className="card-h"><div><div className="ct">当前生效配置 <MBadge kind="mute"><Icon id="lock" size={10} style={{ marginRight: 2 }} />只读</MBadge></div><div className="csub">审稿依据以下已发布版本</div></div></div>
        <div className="ro-list">
          <div className="rr"><span className="rr-k"><Icon id="prompt" size={12} />Prompt</span><span className="rr-v"><MVer v={versionLabel(config?.prompt_version)} /> 当前发布版本</span></div>
          <div className="rr"><span className="rr-k"><Icon id="tags" size={12} />词表</span><span className="rr-v"><MVer v={versionLabel(config?.tag_vocabulary_version)} /> 当前发布版本</span></div>
          <div className="rr"><span className="rr-k"><Icon id="reco" size={12} />推荐策略</span><span className="rr-v"><MVer v={versionLabel(config?.strategy_version)} /> 当前发布版本</span></div>
        </div>
      </div>
      <div className="card pad0">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 15px', borderBottom: '1px solid var(--rule)' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14.5 }}>我的待审队列 <span className="muted numf">· {queue.length}</span></div>
          <button className="btn ghost sm" onClick={refresh} disabled={refreshing}>{refreshing ? <MSpin /> : <Icon id="refresh" size={14} />}</button>
        </div>
        {/* 原型此处是「模拟：稿件被他人处理」按钮 + 冲突 sheet，属于演示用的假冲突。
            与桌面端一致改为说明：真实并发冲突由审稿提交接口返回 409 表达。 */}
        <div style={{ padding: '10px 15px 0' }}><span className="muted" style={{ fontSize: 11.5 }}>真实数据 · 并发冲突由审稿提交接口返回 409</span></div>
        {loading && <MLoading rows={3} />}
        {!loading && loadError && <MError desc={loadError} onRetry={refresh} />}
        {!loading && !loadError && (queue.length ? queue.map((q) => <div key={q.id} className="lrow" style={{ cursor: 'default' }}>
          <div className="lr-t"><div className="lr-n">{q.title}</div><div className="lr-s mono">{q.id} · {q.author} · {q.words} · {q.at}</div></div>
          <div className="lr-meta"><MBadge kind={q.stage === '待初审' ? 'info' : 'warn'}>{q.stage}</MBadge><button className="btn sm" onClick={() => ctx.openReview()}>进入审稿</button></div>
        </div>) : <MEmpty title="暂无待审稿件" desc="新的投稿到达后会出现在这里。" />)}
      </div>
      <div className="banner mute" style={{ background: 'var(--panel-2)', borderColor: 'var(--rule)', color: 'var(--ink-2)' }}><span className="bd" style={{ background: 'var(--ink-4)' }} /><span className="bx">审稿编辑不可见 AI 配置、员工账号与编辑规则编辑入口，仅可读取已发布版本。</span></div>
    </div></div>
  );
}

export function MReviewHistory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const R = { ok: ['ok', '通过'], warn: ['warn', '退回'], err: ['err', '拒稿'] };
  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { setRows((await staffApi.reviewLogs()).map(toUiReviewLog)); }
    catch (error) { setLoadError(errorMessage(error, '审稿记录读取失败。')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  return (
    <div className="scroll fade-in"><div className="pad">
      <p className="lead-p">你近期处理过的稿件与决定。</p>
      <div className="card pad0">
        {loading && <MLoading rows={3} />}
        {!loading && loadError && <MError desc={loadError} onRetry={load} />}
        {!loading && !loadError && rows.length === 0 && <MEmpty title="暂无审稿记录" desc="完成审稿决定后会在这里留下记录。" />}
        {!loading && !loadError && rows.map((x) => <div key={x.id} className="lrow" style={{ cursor: 'default' }}>
          <div className="lr-t"><div className="lr-n">{x.title}</div><div className="lr-s mono">{x.id} · {x.act} · {x.at}</div></div>
          <MBadge kind={R[x.result][0]}>{R[x.result][1]}</MBadge>
        </div>)}
      </div>
    </div></div>
  );
}
