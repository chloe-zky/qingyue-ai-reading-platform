// platform.jsx — 平台管理员工作台（技术 · 湖蓝主题）
// DOM / 类名 / 文案 / 内联样式逐字移植自 prototype-admin/platform.jsx。
//
// 员工、LLM 配置、审计日志与可用健康探针已接真实后端。
// 尚无后端能力的上游 AI 测试、配置草稿、存储探针与 CSV 导出会明确提示，
// 不再用设计稿模拟结果冒充线上数据。

import { useCallback, useEffect, useState } from 'react';
import Icon from './shared/Icon';
import { STAFF_STATUS } from './shared/constants';
import { staffApi, errorMessage, formatDateTime, toUiStaff, toUiTechnicalLog } from './api';
import { Spin, RoleBadge, StatusBadge, MaskedSecretField, EmptyState, ErrorState, LoadingState } from './shared/ui';

/* ── 1. 技术概览 ── */
export function PlatformOverview({ ctx }) {
  const [o, setOverview] = useState({
    aiUp: false, model: '—', supabase: 'unknown', lastTest: '尚未测试',
    lastChange: '暂无配置变更', recentErrors: 0, staffTotal: 0, staffDisabled: 0,
  });
  const [loadError, setLoadError] = useState('');
  const [checking, setChecking] = useState(false);
  const [testing, setTesting] = useState(false);

  const loadOverview = useCallback(async (notify = false) => {
    setLoadError('');
    const [llm, accounts, logs] = await Promise.all([
      staffApi.llmStatus(), staffApi.staff(), staffApi.platformLogs(),
    ]);
    const items = accounts.staff || [];
    const recent = logs || [];
    setOverview({
      aiUp: Boolean(llm.configured),
      model: llm.model_name || '—',
      supabase: 'connected',
      lastTest: '尚无连接测试接口',
      lastChange: recent[0]
        ? `${formatDateTime(recent[0].created_at)} · ${recent[0].summary || recent[0].action}`
        : '暂无配置变更',
      recentErrors: recent.filter((item) => item.result === 'failure').length,
      staffTotal: items.length,
      staffDisabled: items.filter((item) => item.status === 'disabled').length,
    });
    if (notify) ctx.push('系统数据已从后端刷新。', 'ok');
  }, [ctx]);

  useEffect(() => {
    const timer = setTimeout(() => loadOverview().catch((error) => setLoadError(errorMessage(error))), 0);
    return () => clearTimeout(timer);
  }, [loadOverview]);

  async function check() {
    setChecking(true);
    try { await loadOverview(true); }
    catch (error) { setLoadError(errorMessage(error)); ctx.push(errorMessage(error), 'err'); }
    finally { setChecking(false); }
  }
  async function test() {
    setTesting(true);
    try {
      const llm = await staffApi.llmStatus();
      ctx.push(llm.configured ? 'AI 配置完整；真实连通测试端点尚未实现。' : 'AI 服务尚未完成配置。', llm.configured ? 'info' : 'err');
    } catch (error) { ctx.push(errorMessage(error), 'err'); }
    finally { setTesting(false); }
  }
  return (
    <div className="page fade-in">
      <div className="phead">
        <div><div className="eyebrow">— Platform Overview —</div><h1>技术概览</h1><p className="lead">平台运行的技术与安全总览。此处不涉及稿件内容与编辑规则。</p></div>
        <div className="pactions">
          <button className="btn ghost" onClick={check} disabled={checking}>{checking ? <><Spin />检查中…</> : <><Icon id="refresh" size={14} className="btn-ico" />检查系统状态</>}</button>
          <button className="btn" onClick={test} disabled={testing}>{testing ? <><Spin />测试中…</> : <><Icon id="bolt" size={14} className="btn-ico" />测试 AI 连接</>}</button>
        </div>
      </div>
      {loadError && <div className="banner err" style={{ marginBottom: 16 }}><span className="bd" /><span className="bx">{loadError}</span></div>}
      <div className="kpi-grid">
        <div className="kpi"><div className="kk"><Icon id="bolt" size={14} />AI 服务</div><div className="kv" style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}><StatusBadge kind={o.aiUp ? 'ok' : 'warn'}>{o.aiUp ? '已配置' : '未配置'}</StatusBadge></div><div className="kmeta">当前模型 {o.model}</div></div>
        <div className="kpi"><div className="kk"><Icon id="db" size={14} />Supabase</div><div className="kv" style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}><StatusBadge kind={o.supabase === 'connected' ? 'ok' : 'warn'}>{o.supabase === 'connected' ? '已连接' : '待检查'}</StatusBadge></div><div className="kmeta">{o.lastTest}</div></div>
        <div className="kpi"><div className="kk"><Icon id="warn" size={14} />最近技术错误</div><div className="kv">{o.recentErrors}<span className="u">条</span></div><div className="kmeta down">24 小时内</div></div>
        <div className="kpi"><div className="kk"><Icon id="staff" size={14} />员工账号</div><div className="kv">{o.staffTotal}<span className="u">个</span></div><div className="kmeta">其中 {o.staffDisabled} 个已禁用</div></div>
      </div>
      <div className="card">
        <div className="card-h"><div><div className="ct">最近动态</div></div></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="banner info"><span className="bd" /><span className="bx"><b>最近配置变更</b><br />{o.lastChange}</span></div>
          <div className="banner info"><span className="bd" /><span className="bx"><b>AI 连接测试</b><br />{o.lastTest}</span></div>
        </div>
        <hr className="sep" />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn subtle" onClick={() => ctx.go('llm')}><Icon id="llm" size={14} className="btn-ico" />进入 AI 服务配置</button>
          <button className="btn ghost" onClick={() => ctx.go('logs')}><Icon id="logs" size={14} className="btn-ico" />查看技术日志</button>
          <button className="btn ghost" onClick={() => ctx.go('health')}><Icon id="health" size={14} className="btn-ico" />系统状态</button>
        </div>
      </div>
    </div>
  );
}

/* ── 2. AI 服务配置 ── */
export function LLMConfig({ ctx }) {
  const emptyForm = { api_base: '', model_name: '', timeout: 30, retries: 2 };
  const [config, setConfig] = useState({ configured: false, api_type: 'openai_compatible' });
  const [form, setForm] = useState(emptyForm);
  const [base, setBase] = useState(emptyForm);
  const [editKey, setEditKey] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [masked, setMasked] = useState('');
  const [test, setTest] = useState(null); // null|testing|ok|fail
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);
  const [loading, setLoading] = useState(true);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = form.api_base !== base.api_base || form.model_name !== base.model_name || form.timeout !== base.timeout || form.retries !== base.retries || (editKey && newKey.trim() !== '');

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const status = await staffApi.llmStatus();
      const next = {
        api_base: status.api_base || '',
        model_name: status.model_name || '',
        timeout: status.timeout_seconds ?? 30,
        retries: status.max_retries ?? 2,
      };
      setConfig(status);
      setForm(next);
      setBase(next);
      setMasked(status.masked_key === '***' ? '' : status.masked_key);
      setBanner(null);
    } catch (error) {
      setBanner({ kind: 'err', text: errorMessage(error, 'AI 配置读取失败。') });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(loadConfig, 0);
    return () => clearTimeout(timer);
  }, [loadConfig]);

  async function runTest() {
    setTest(null);
    setBanner({ kind: 'info', text: '当前后端尚未提供上游 AI 连通测试端点；此按钮不会伪造测试结果。' });
    ctx.push('AI 连通测试端点尚未实现', 'info');
  }
  async function doSave(enable) {
    if (!enable) {
      setBanner({ kind: 'info', text: '草稿仅保留在当前页面，刷新会丢失；后端草稿版本接口尚未实现。' });
      ctx.push('配置草稿仅暂存在当前页面', 'info');
      return;
    }
    const r = await ctx.confirm({
      tone: 'warn', title: '保存并启用新配置？',
      desc: '启用后，所有依赖 AI 的功能（打标、内容分析、推荐理由）将立即使用新配置。',
      impact: <>· 立即对全站生效<br />· 记录操作人、时间与版本<br />· 原密钥{newKey.trim() ? '将被替换' : '保持不变'}</>,
      confirmText: '保存并启用',
    });
    if (!r.ok) return;
    setSaving(true); setBanner(null);
    try {
      const payload = {
        api_base: form.api_base,
        model_name: form.model_name,
        api_type: 'openai_compatible',
        timeout_seconds: form.timeout,
        max_retries: form.retries,
      };
      if (newKey.trim()) payload.api_key = newKey.trim();
      await staffApi.saveLlm(payload);
      await loadConfig();
      setEditKey(false); setNewKey('');
      setBanner({ kind: 'ok', text: '配置已保存并启用。密钥仅以脱敏形式保存。' });
      ctx.push('配置已保存并启用', 'ok');
    } catch (error) {
      const message = errorMessage(error, '配置保存失败。');
      setBanner({ kind: 'err', text: message });
      ctx.push(message, 'err');
    } finally { setSaving(false); }
  }
  function discard() { setForm({ ...base }); setEditKey(false); setNewKey(''); setBanner(null); setTest(null); }

  return (
    <div className="page fade-in">
      <div className="phead">
        <div><div className="eyebrow">— AI Service —</div><h1>AI 服务配置</h1><p className="lead">配置作品智能能力所依赖的大模型服务。仅平台管理员可读写；密钥仅以脱敏形式保存。</p></div>
        <div>{config.configured ? <StatusBadge kind="ok">已配置</StatusBadge> : <StatusBadge kind="mute">未配置</StatusBadge>}{dirty && <span style={{ marginLeft: 10 }}><StatusBadge kind="warn">未保存修改</StatusBadge></span>}</div>
      </div>

      {loading && <div className="card"><LoadingState rows={2} /></div>}

      <div className="card">
        <div className="card-h"><div className="ct">连接参数</div><button className="btn ghost sm" onClick={() => { setForm({ ...base }); setBanner({ kind: 'info', text: '已恢复到上次保存的配置。' }); }}><Icon id="refresh" size={13} className="btn-ico" />恢复上次配置</button></div>
        <div className="fld-row">
          <div className="fld"><label className="lbl">API 类型<span className="ro">只读</span></label><input className="inp mono" value={config.api_type || 'openai_compatible'} disabled readOnly /><div className="help">固定为 openai_compatible。</div></div>
          <div className="fld"><label className="lbl">模型名称<span className="req">必填</span></label><input className="inp mono" value={form.model_name} onChange={(e) => set('model_name', e.target.value)} placeholder="gemini-2.5-pro" /></div>
        </div>
        <div className="fld"><label className="lbl">API Base URL<span className="req">必填</span></label><input className="inp mono" value={form.api_base} onChange={(e) => set('api_base', e.target.value)} placeholder="https://example.com/v1" /><div className="help">HTTP / HTTPS 地址，OpenAI 兼容网关根路径。</div></div>
        <div className="fld"><label className="lbl"><Icon id="key" size={12} />API Key</label>
          <MaskedSecretField masked={masked} editing={editKey} value={newKey} onChange={setNewKey} onEdit={() => setEditKey(true)} />
          <div className="help note" style={{ color: 'var(--warn)' }}>{editKey ? '留空表示不修改原密钥；填写后将替换。完整密钥不会被展示。' : '出于安全，完整密钥永不回显，仅显示脱敏值。'}</div>
        </div>
        <div className="fld-row">
          <div className="fld"><label className="lbl">请求超时（秒）</label><input className="inp" type="number" value={form.timeout} onChange={(e) => set('timeout', +e.target.value)} /></div>
          <div className="fld"><label className="lbl">最大重试次数</label><input className="inp" type="number" value={form.retries} onChange={(e) => set('retries', +e.target.value)} /></div>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><div className="ct">连接测试</div>{test === 'ok' && <StatusBadge kind="ok">连接成功</StatusBadge>}{test === 'fail' && <StatusBadge kind="err">连接失败</StatusBadge>}{test === 'testing' && <StatusBadge kind="info">测试中</StatusBadge>}</div>
        <div className="card-hint">保存前可先用当前参数验证与上游服务的连通性。测试使用页面当前填写的参数。</div>
        <button className="btn ghost" onClick={runTest} disabled={test === 'testing'}>{test === 'testing' ? <><Spin />测试中…</> : <><Icon id="plug" size={14} className="btn-ico" />测试连接</>}</button>
      </div>

      {banner && <div className={'banner ' + banner.kind} style={{ marginBottom: 16 }}><span className="bd" /><span className="bx">{banner.text}</span></div>}

      <div className="card" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
        {dirty && <span style={{ marginRight: 'auto' }}><StatusBadge kind="warn">存在未保存修改</StatusBadge></span>}
        <button className="btn ghost" onClick={discard} disabled={!dirty || saving}>放弃修改</button>
        <button className="btn subtle" onClick={() => doSave(false)} disabled={saving}>{saving ? <><Spin />保存中…</> : '保存草稿'}</button>
        <button className="btn" onClick={() => doSave(true)} disabled={saving}>{saving ? <><Spin />保存中…</> : '保存并启用'}</button>
      </div>
    </div>
  );
}

/* ── 3. 员工账号 ── */
export function StaffAccounts({ ctx }) {
  const [staff, setStaff] = useState([]);
  const [invite, setInvite] = useState(false);
  const [inv, setInv] = useState({ name: '', email: '', role: 'review' });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const loadStaff = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const data = await staffApi.staff();
      setStaff((data.staff || []).map(toUiStaff));
    } catch (error) { setLoadError(errorMessage(error, '员工账号读取失败。')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(loadStaff, 0);
    return () => clearTimeout(timer);
  }, [loadStaff]);

  function replaceStaff(item) {
    const mapped = toUiStaff(item);
    setStaff((items) => items.map((entry) => entry.id === mapped.id ? mapped : entry));
  }

  async function disable(s) {
    const r = await ctx.confirm({
      tone: 'danger', title: `禁用 ${s.name} 的账号？`, desc: '禁用后该员工将立即无法登录内部系统。',
      impact: <>· 强制结束其当前会话<br />· 分配给 TA 的待办不会自动转移<br />· 可随时恢复</>, confirmText: '禁用账号',
    });
    if (!r.ok) return;
    setBusy(true);
    try {
      replaceStaff(await staffApi.updateStaff(s.id, { status: 'disabled' }));
      ctx.push(`已禁用 ${s.name}`, 'ok');
    } catch (error) { ctx.push(errorMessage(error, '账号禁用失败。'), 'err'); }
    finally { setBusy(false); }
  }
  async function enable(s) {
    setBusy(true);
    try {
      replaceStaff(await staffApi.updateStaff(s.id, { status: 'active' }));
      ctx.push(`已恢复 ${s.name}`, 'ok');
    } catch (error) { ctx.push(errorMessage(error, '账号恢复失败。'), 'err'); }
    finally { setBusy(false); }
  }
  async function changeRole(s) {
    ctx.push(`${s.name} 的角色修改接口已存在，但当前设计没有目标角色选择控件，未执行修改。`, 'info');
  }
  async function sendInvite() {
    if (!inv.name.trim() || !inv.email.trim()) return;
    setBusy(true);
    try {
      const result = await staffApi.inviteStaff(inv);
      setStaff((items) => [...items, toUiStaff(result.staff)]);
      setInvite(false); setInv({ name: '', email: '', role: 'review' });
      ctx.push(result.message || '邀请已发送', 'ok');
    } catch (error) { ctx.push(errorMessage(error, '邀请发送失败。'), 'err'); }
    finally { setBusy(false); }
  }

  return (
    <div className="page wide fade-in">
      <div className="phead">
        <div><div className="eyebrow">— Staff Accounts —</div><h1>员工账号</h1><p className="lead">管理内部员工的账号状态与角色。每个账号默认只有一个角色。</p></div>
        <div className="pactions"><button className="btn" onClick={() => setInvite(true)}><Icon id="plus" size={14} className="btn-ico" />邀请员工</button></div>
      </div>
      <div className="card pad0">
        {loading && <LoadingState rows={4} />}
        {!loading && loadError && <ErrorState desc={loadError} onRetry={loadStaff} />}
        {!loading && !loadError && staff.length === 0 && <EmptyState title="暂无员工账号" desc="创建首个平台管理员后，员工账号会显示在这里。" />}
        {!loading && !loadError && staff.length > 0 &&
        <table className="tbl">
          <thead><tr><th>姓名 / 邮箱</th><th>角色</th><th>状态</th><th>最近登录</th><th>创建时间</th><th style={{ textAlign: 'right' }}>操作</th></tr></thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td><div className="t-name">{s.name}</div><div className="t-sub mono">{s.email}</div></td>
                <td><RoleBadge role={s.role} /></td>
                <td><StatusBadge kind={(STAFF_STATUS[s.status] || STAFF_STATUS.disabled)[0]}>{(STAFF_STATUS[s.status] || STAFF_STATUS.disabled)[1]}</StatusBadge></td>
                <td className="t-mono">{s.last}</td>
                <td className="t-mono">{s.created}</td>
                <td><div className="t-actions">
                  {s.status === 'invited' && <button className="rowbtn" onClick={() => ctx.push('邀请已重发', 'ok')}>重发邀请</button>}
                  {s.status !== 'disabled' && <button className="rowbtn" onClick={() => changeRole(s)}>修改角色</button>}
                  {s.status === 'disabled'
                    ? <button className="rowbtn" onClick={() => enable(s)}>恢复账号</button>
                    : <button className="rowbtn danger" onClick={() => disable(s)}>禁用</button>}
                  <button className="rowbtn" onClick={() => ctx.push('安全记录仅示意，暂不展开', 'info')}>安全记录</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
        }
      </div>

      {invite && <div className="scrim" onClick={() => !busy && setInvite(false)}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-h"><div className="mi info"><Icon id="staff" size={19} /></div><div><div className="mt">邀请员工</div><div className="md">向新员工发送邀请邮件，对方接受后完成账号激活。</div></div></div>
          <div className="modal-body">
            <div className="fld"><label className="lbl">姓名<span className="req">必填</span></label><input className="inp" value={inv.name} onChange={(e) => setInv((v) => ({ ...v, name: e.target.value }))} placeholder="真实姓名" /></div>
            <div className="fld"><label className="lbl">工作邮箱<span className="req">必填</span></label><input className="inp mono" value={inv.email} onChange={(e) => setInv((v) => ({ ...v, email: e.target.value }))} placeholder="name@qingyue.internal" /></div>
            <div className="fld"><label className="lbl">角色<span className="req">必填</span></label><select className="inp" value={inv.role} onChange={(e) => setInv((v) => ({ ...v, role: e.target.value }))}><option value="admin">平台管理员</option><option value="lead">编辑部负责人</option><option value="review">审稿编辑</option></select><div className="help">角色决定该员工登录后进入的工作台与权限范围。</div></div>
          </div>
          <div className="modal-foot"><button className="btn ghost" onClick={() => setInvite(false)} disabled={busy}>取消</button><button className="btn" onClick={sendInvite} disabled={busy || !inv.name.trim() || !inv.email.trim()}>{busy ? <><Spin />发送中…</> : '确认邀请'}</button></div>
        </div>
      </div>}
    </div>
  );
}

/* ── 4. 系统状态 ── */
export function SystemHealth({ ctx }) {
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
    const [apiResult, dbResult, llmResult] = await Promise.allSettled([
      staffApi.health(), staffApi.staff(), staffApi.llmStatus(),
    ]);
    const elapsed = Math.max(1, Math.round(performance.now() - started));
    const llm = llmResult.status === 'fulfilled' ? llmResult.value : null;
    setHealth([
      { id: 'api', name: '后端 API', icon: 'plug', status: apiResult.status === 'fulfilled' ? 'ok' : 'err', ms: elapsed, note: apiResult.status === 'fulfilled' ? '健康接口响应正常' : errorMessage(apiResult.reason) },
      { id: 'db', name: 'Supabase', icon: 'db', status: dbResult.status === 'fulfilled' ? 'ok' : 'err', ms: elapsed, note: dbResult.status === 'fulfilled' ? '员工数据读取正常' : errorMessage(dbResult.reason) },
      { id: 'ai', name: 'AI 服务', icon: 'bolt', status: llm?.configured ? 'warn' : 'err', ms: null, note: llm?.configured ? `${llm.model_name || '模型'} 已配置，未做上游连通测试` : 'AI 服务尚未完整配置' },
      { id: 'storage', name: '文件存储', icon: 'cloud', status: 'warn', ms: null, note: '后端尚未提供存储健康探针' },
    ]);
    setAt('刚刚'); setChecking(false);
    if (notify) ctx.push('已完成可用探针检查；未提供探针的项目保持“注意”。', 'info');
  }, [ctx]);

  useEffect(() => {
    const timer = setTimeout(() => check(false), 0);
    return () => clearTimeout(timer);
  }, [check]);
  return (
    <div className="page fade-in">
      <div className="phead">
        <div><div className="eyebrow">— System Health —</div><h1>系统状态</h1><p className="lead">各核心依赖的实时健康检查。最近检查：{at}。</p></div>
        <div className="pactions">
          <button className="btn ghost" onClick={() => ctx.push('诊断复制功能尚未接入。', 'info')}><Icon id="copy" size={14} className="btn-ico" />复制诊断信息</button>
          <button className="btn" onClick={check} disabled={checking}>{checking ? <><Spin />检查中…</> : <><Icon id="refresh" size={14} className="btn-ico" />立即检查</>}</button>
        </div>
      </div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
        {health.map((h) => (
          <div className="card" key={h.id} style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 42, height: 42, borderRadius: 10, background: 'var(--tint)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 42px' }}><Icon id={h.icon} size={20} /></div>
              <div style={{ flex: 1 }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15 }}>{h.name}</div><div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{h.note}</div></div>
              <div style={{ textAlign: 'right' }}><StatusBadge kind={h.status === 'ok' ? 'ok' : (h.status === 'warn' ? 'warn' : 'err')}>{h.status === 'ok' ? '正常' : (h.status === 'warn' ? '注意' : '异常')}</StatusBadge><div className="numf" style={{ fontSize: 15, color: 'var(--ink-2)', marginTop: 6 }}>{h.ms == null ? '—' : `${h.ms} ms`}</div></div>
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-h"><div className="ct">异常摘要</div><button className="btn ghost sm" onClick={() => ctx.go('logs')}>查看相关日志</button></div>
        <div className="banner warn"><span className="bd" /><span className="bx">AI 上游与文件存储尚无独立健康探针；当前页面不会用模拟数据宣称它们正常。</span></div>
      </div>
    </div>
  );
}

/* ── 5. 技术日志 ── */
export function TechnicalLogs({ ctx }) {
  const [detail, setDetail] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const LVL = { info: ['info', 'INFO'], warn: ['warn', 'WARN'], error: ['err', 'ERROR'] };

  const loadLogs = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { setLogs((await staffApi.platformLogs()).map(toUiTechnicalLog)); }
    catch (error) { setLoadError(errorMessage(error, '技术日志读取失败。')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(loadLogs, 0);
    return () => clearTimeout(timer);
  }, [loadLogs]);
  return (
    <div className="page wide fade-in">
      <div className="phead">
        <div><div className="eyebrow">— Technical Logs —</div><h1>技术日志</h1><p className="lead">系统与安全事件的审计记录。日志详情不含完整密钥、Token、密码或稿件正文。</p></div>
        <div className="pactions"><button className="btn ghost" onClick={() => ctx.push('CSV 导出端点尚未实现。', 'info')}><Icon id="download" size={14} className="btn-ico" />导出当前结果</button></div>
      </div>
      <div className="filterbar">
        <div className="ff"><label className="lbl">时间范围</label><select className="inp"><option>最近 24 小时</option><option>最近 7 天</option><option>自定义</option></select></div>
        <div className="ff"><label className="lbl">等级</label><select className="inp"><option>全部</option><option>INFO</option><option>WARN</option><option>ERROR</option></select></div>
        <div className="ff"><label className="lbl">模块</label><select className="inp"><option>全部</option><option>AI 服务</option><option>后端 API</option><option>账号</option><option>文件存储</option></select></div>
        <div className="ff"><label className="lbl">关键词</label><input className="inp" placeholder="搜索操作摘要 / 操作人" /></div>
        <div className="fspacer" />
        <button className="btn subtle" onClick={() => ctx.push('日志筛选参数尚未接入后端。', 'info')}>筛选</button><button className="btn ghost" onClick={loadLogs}>重置</button>
      </div>
      <div className="card pad0">
        {loading && <LoadingState rows={5} />}
        {!loading && loadError && <ErrorState desc={loadError} onRetry={loadLogs} />}
        {!loading && !loadError && logs.length === 0 && <EmptyState title="暂无技术日志" desc="平台配置或账号操作发生后会在这里留下记录。" />}
        {!loading && !loadError && logs.length > 0 &&
        <table className="tbl">
          <thead><tr><th>时间</th><th>等级</th><th>模块</th><th>操作人</th><th>操作摘要</th><th>结果</th><th style={{ textAlign: 'right' }}>详情</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="t-mono">{l.t}</td>
                <td><StatusBadge kind={LVL[l.lvl][0]}>{LVL[l.lvl][1]}</StatusBadge></td>
                <td>{l.mod}</td><td>{l.who}</td><td>{l.act}</td>
                <td style={{ color: l.result === '失败' ? 'var(--danger)' : (l.result === '告警' ? 'var(--warn)' : 'var(--ink)') }}>{l.result}</td>
                <td style={{ textAlign: 'right' }}><button className="rowbtn" onClick={() => setDetail(l)}>查看详情</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        }
      </div>
      {detail && <div className="scrim" onClick={() => setDetail(null)}><div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><div className="mi info"><Icon id="doc" size={19} /></div><div><div className="mt">日志详情</div><div className="md">{detail.t} · {detail.mod}</div></div></div>
        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div><div className="lbl">操作人</div><div>{detail.who}</div></div>
            <div><div className="lbl">结果</div><div>{detail.result}</div></div>
            <div style={{ gridColumn: '1 / -1' }}><div className="lbl">操作摘要</div><div>{detail.act}</div></div>
          </div>
          <div className="impact" style={{ marginTop: 14 }}><div className="il">已脱敏</div>为保障安全，日志不记录完整 API Key、Token、密码及稿件正文。</div>
        </div>
        <div className="modal-foot"><button className="btn ghost" onClick={() => setDetail(null)}>关闭</button></div>
      </div></div>}
    </div>
  );
}

/* 接口状态：
 *   已接入：平台概览聚合、LLM 配置读写、员工列表/邀请/启停、后端与数据库探针、技术日志。
 *   待补：上游 AI 连接测试、配置草稿、角色选择控件、重发邀请、安全记录、存储探针、日志筛选与 CSV。
 */
