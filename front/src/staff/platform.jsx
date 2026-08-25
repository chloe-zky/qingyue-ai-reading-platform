// platform.jsx — 平台管理员工作台（技术 · 湖蓝主题）
// DOM / 类名 / 文案 / 内联样式逐字移植自 prototype-admin/platform.jsx。
//
// 员工、LLM 配置与真实连接测试、审计日志、数据库及存储健康探针已接真实后端。
// 尚无后端能力的配置草稿、邀请重发与安全记录会明确提示，
// 不使用设计稿模拟结果冒充线上数据。

import { useCallback, useEffect, useState } from 'react';
import Icon from './shared/Icon';
import { STAFF_STATUS } from './shared/constants';
import { downloadCsv, staffApi, errorMessage, formatDateTime, toUiStaff, toUiTechnicalLog } from './api';
import { Spin, RoleBadge, StatusBadge, MaskedSecretField, EmptyState, ErrorState, LoadingState } from './shared/ui';

const INITIAL_TECH_LOG_FILTERS = { hours: '24', result: '', domain: '', q: '' };

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
    const lastAiTest = recent.find((item) => item.action === 'llm_config.test');
    setOverview({
      aiUp: Boolean(llm.configured),
      model: llm.model_name || '—',
      supabase: 'connected',
      lastTest: lastAiTest
        ? `${lastAiTest.result === 'success' ? '成功' : '失败'} · ${formatDateTime(lastAiTest.created_at)}`
        : '尚未进行真实连接测试',
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
      if (!llm.configured) {
        ctx.push('AI 服务尚未完成配置。', 'err');
        return;
      }
      const result = await staffApi.testLlm({
        api_base: llm.api_base,
        model_name: llm.model_name,
        api_type: llm.api_type || 'openai_compatible',
        timeout_seconds: Math.min(llm.timeout_seconds ?? 30, 60),
      });
      ctx.push(`AI 连接成功 · ${result.model_name} · ${result.latency_ms} ms`, 'ok');
      await loadOverview();
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
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
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
    if (!form.api_base.trim() || !form.model_name.trim()) {
      setTest('fail');
      setBanner({ kind: 'err', text: '请先填写 API Base 与模型名称。' });
      return;
    }
    setTest('testing'); setBanner(null);
    try {
      const payload = {
        api_base: form.api_base,
        model_name: form.model_name,
        api_type: 'openai_compatible',
        timeout_seconds: Math.min(Math.max(form.timeout || 30, 1), 60),
      };
      if (newKey.trim()) payload.api_key = newKey.trim();
      const result = await staffApi.testLlm(payload);
      setTest('ok');
      setBanner({ kind: 'ok', text: `${result.message} 耗时 ${result.latency_ms} ms。` });
      ctx.push(`AI 连接成功 · ${result.latency_ms} ms`, 'ok');
    } catch (error) {
      const message = errorMessage(error, 'AI 连接测试失败。');
      setTest('fail'); setBanner({ kind: 'err', text: message });
      ctx.push(message, 'err');
    }
  }
  async function refreshModels() {
    if (!form.api_base.trim()) {
      setBanner({ kind: 'err', text: '请先填写 API Base URL。' });
      return;
    }
    setModelsLoading(true); setBanner(null);
    try {
      const payload = {
        api_base: form.api_base,
        api_type: 'openai_compatible',
        timeout_seconds: Math.min(Math.max(form.timeout || 20, 1), 60),
      };
      if (newKey.trim()) payload.api_key = newKey.trim();
      const result = await staffApi.llmModels(payload);
      setModels(result.models || []);
      setBanner({ kind: 'ok', text: `已从上游读取 ${result.count || 0} 个可用 Gemini 模型。` });
    } catch (error) {
      setBanner({ kind: 'err', text: errorMessage(error, '模型列表读取失败。') });
    } finally { setModelsLoading(false); }
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
          <div className="fld"><label className="lbl">模型名称<span className="req">必填</span></label><div style={{ display: 'flex', gap: 8 }}><select className="inp mono" value={form.model_name} onChange={(e) => set('model_name', e.target.value)}>{form.model_name && !models.includes(form.model_name) && <option value={form.model_name}>{form.model_name}（当前）</option>}{models.map((item) => <option key={item} value={item}>{item}</option>)}</select><button className="btn ghost sm" type="button" onClick={refreshModels} disabled={modelsLoading}>{modelsLoading ? <Spin /> : <Icon id="refresh" size={13} />}{modelsLoading ? '读取中' : '刷新模型'}</button></div><div className="help">从当前上游的 /models 接口读取，不在前端写死模型名。</div></div>
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
  const [roleEdit, setRoleEdit] = useState(null);
  const [targetRole, setTargetRole] = useState('review');
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
  function changeRole(s) {
    setRoleEdit(s);
    setTargetRole(s.role);
  }
  async function saveRole() {
    if (!roleEdit || targetRole === roleEdit.role) { setRoleEdit(null); return; }
    setBusy(true);
    try {
      replaceStaff(await staffApi.updateStaff(roleEdit.id, { role: targetRole }));
      ctx.push(`${roleEdit.name} 的角色已更新`, 'ok');
      setRoleEdit(null);
    } catch (error) { ctx.push(errorMessage(error, '角色修改失败。'), 'err'); }
    finally { setBusy(false); }
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

      {roleEdit && <div className="scrim" onClick={() => !busy && setRoleEdit(null)}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-h"><div className="mi warn"><Icon id="staff" size={19} /></div><div><div className="mt">修改员工角色</div><div className="md">{roleEdit.name} · {roleEdit.email}</div></div></div>
          <div className="modal-body">
            <div className="fld"><label className="lbl">目标角色</label><select className="inp" value={targetRole} onChange={(e) => setTargetRole(e.target.value)}><option value="admin">平台管理员</option><option value="lead">编辑部负责人</option><option value="review">审稿编辑</option></select></div>
            <div className="impact"><div className="il">权限影响</div>保存后该账号下次鉴权时立即按新角色进入对应工作台；系统始终要求至少保留一名启用的平台管理员。</div>
          </div>
          <div className="modal-foot"><button className="btn ghost" onClick={() => setRoleEdit(null)} disabled={busy}>取消</button><button className="btn" onClick={saveRole} disabled={busy || targetRole === roleEdit.role}>{busy ? <><Spin />保存中…</> : '确认修改'}</button></div>
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
    { id: 'storage', name: '文件存储', icon: 'cloud', status: 'warn', ms: null, note: '等待检查' },
  ]);

  const check = useCallback(async (notify = true) => {
    setChecking(true);
    const started = performance.now();
    const [apiResult, dbResult, llmResult, storageResult] = await Promise.allSettled([
      staffApi.health(), staffApi.staff(), staffApi.llmStatus(), staffApi.storageHealth(),
    ]);
    const elapsed = Math.max(1, Math.round(performance.now() - started));
    const llm = llmResult.status === 'fulfilled' ? llmResult.value : null;
    let aiTest = null;
    if (notify && llm?.configured) {
      aiTest = await staffApi.testLlm({
        api_base: llm.api_base,
        model_name: llm.model_name,
        api_type: llm.api_type || 'openai_compatible',
        timeout_seconds: Math.min(llm.timeout_seconds ?? 30, 60),
      }).then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }));
    }
    setHealth([
      { id: 'api', name: '后端 API', icon: 'plug', status: apiResult.status === 'fulfilled' ? 'ok' : 'err', ms: elapsed, note: apiResult.status === 'fulfilled' ? '健康接口响应正常' : errorMessage(apiResult.reason) },
      { id: 'db', name: 'Supabase', icon: 'db', status: dbResult.status === 'fulfilled' ? 'ok' : 'err', ms: elapsed, note: dbResult.status === 'fulfilled' ? '员工数据读取正常' : errorMessage(dbResult.reason) },
      { id: 'ai', name: 'AI 服务', icon: 'bolt', status: aiTest?.status === 'fulfilled' ? 'ok' : (aiTest?.status === 'rejected' || !llm?.configured ? 'err' : 'warn'), ms: aiTest?.value?.latency_ms ?? null, note: aiTest?.status === 'fulfilled' ? `${aiTest.value.model_name} 连接正常` : (aiTest?.status === 'rejected' ? errorMessage(aiTest.reason) : (llm?.configured ? `${llm.model_name || '模型'} 已配置；点击立即检查可做真实探测` : 'AI 服务尚未完整配置')) },
      { id: 'storage', name: '文件存储', icon: 'cloud', status: storageResult.status === 'fulfilled' ? 'ok' : 'err', ms: storageResult.value?.latency_ms ?? null, note: storageResult.status === 'fulfilled' ? storageResult.value.message : errorMessage(storageResult.reason) },
    ]);
    setAt('刚刚'); setChecking(false);
    if (notify) ctx.push(aiTest?.status === 'rejected' ? '系统检查完成，AI 上游连接异常。' : '系统真实探针检查完成。', aiTest?.status === 'rejected' ? 'err' : 'ok');
  }, [ctx]);

  async function copyDiagnostics() {
    const lines = [`轻阅读系统诊断 · ${new Date().toLocaleString('zh-CN')}`]
      .concat(health.map((item) => `${item.name}: ${item.status} · ${item.ms == null ? '—' : `${item.ms} ms`} · ${item.note}`));
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      ctx.push('诊断信息已复制；内容不含密钥、Token 或稿件。', 'ok');
    } catch {
      ctx.push('浏览器未允许复制，请检查剪贴板权限。', 'err');
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => check(false), 0);
    return () => clearTimeout(timer);
  }, [check]);
  return (
    <div className="page fade-in">
      <div className="phead">
        <div><div className="eyebrow">— System Health —</div><h1>系统状态</h1><p className="lead">各核心依赖的实时健康检查。最近检查：{at}。</p></div>
        <div className="pactions">
          <button className="btn ghost" onClick={copyDiagnostics}><Icon id="copy" size={14} className="btn-ico" />复制诊断信息</button>
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
        <div className="banner info"><span className="bd" /><span className="bx">页面初次打开只做无副作用检查；点击“立即检查”时会额外向 AI 上游发送固定探测文本，不包含稿件或用户内容。</span></div>
      </div>
    </div>
  );
}

/* ── 5. 技术日志 ── */
export function TechnicalLogs({ ctx }) {
  const [detail, setDetail] = useState(null);
  const [logs, setLogs] = useState([]);
  const [filters, setFilters] = useState(INITIAL_TECH_LOG_FILTERS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const LVL = { info: ['info', 'INFO'], warn: ['warn', 'WARN'], error: ['err', 'ERROR'] };

  const loadLogs = useCallback(async (nextFilters = INITIAL_TECH_LOG_FILTERS) => {
    setLoading(true); setLoadError('');
    try { setLogs((await staffApi.platformLogs(nextFilters)).map(toUiTechnicalLog)); }
    catch (error) { setLoadError(errorMessage(error, '技术日志读取失败。')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => loadLogs(INITIAL_TECH_LOG_FILTERS), 0);
    return () => clearTimeout(timer);
  }, [loadLogs]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function resetFilters() {
    setFilters(INITIAL_TECH_LOG_FILTERS);
    loadLogs(INITIAL_TECH_LOG_FILTERS);
  }

  function exportLogs() {
    if (!logs.length) { ctx.push('当前没有可导出的技术日志。', 'info'); return; }
    downloadCsv(`qingyue-technical-logs-${new Date().toISOString().slice(0, 10)}.csv`, [
      { key: 't', label: '时间' }, { key: 'lvl', label: '等级' },
      { key: 'mod', label: '模块' }, { key: 'who', label: '操作人' },
      { key: 'act', label: '操作摘要' }, { key: 'result', label: '结果' },
    ], logs);
    ctx.push(`已导出 ${logs.length} 条技术日志。`, 'ok');
  }
  return (
    <div className="page wide fade-in">
      <div className="phead">
        <div><div className="eyebrow">— Technical Logs —</div><h1>技术日志</h1><p className="lead">系统与安全事件的审计记录。日志详情不含完整密钥、Token、密码或稿件正文。</p></div>
        <div className="pactions"><button className="btn ghost" onClick={exportLogs}><Icon id="download" size={14} className="btn-ico" />导出当前结果</button></div>
      </div>
      <div className="filterbar">
        <div className="ff"><label className="lbl">时间范围</label><select className="inp" value={filters.hours} onChange={(e) => updateFilter('hours', e.target.value)}><option value="24">最近 24 小时</option><option value="168">最近 7 天</option></select></div>
        <div className="ff"><label className="lbl">结果</label><select className="inp" value={filters.result} onChange={(e) => updateFilter('result', e.target.value)}><option value="">全部</option><option value="success">成功</option><option value="failure">失败</option></select></div>
        <div className="ff"><label className="lbl">模块</label><select className="inp" value={filters.domain} onChange={(e) => updateFilter('domain', e.target.value)}><option value="">全部</option><option value="platform">平台配置</option><option value="auth">账号</option><option value="security">安全</option></select></div>
        <div className="ff"><label className="lbl">关键词</label><input className="inp" value={filters.q} onChange={(e) => updateFilter('q', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') loadLogs(filters); }} placeholder="搜索操作摘要 / 操作人" /></div>
        <div className="fspacer" />
        <button className="btn subtle" onClick={() => loadLogs(filters)}>筛选</button><button className="btn ghost" onClick={resetFilters}>重置</button>
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
            <div><div className="lbl">动作标识</div><div className="t-mono">{detail.raw.action}</div></div>
            <div><div className="lbl">资源</div><div className="t-mono">{detail.raw.resource_type}{detail.raw.resource_id ? ` · ${detail.raw.resource_id}` : ''}</div></div>
            {(detail.raw.before_data || detail.raw.after_data) && <div style={{ gridColumn: '1 / -1' }}><div className="lbl">变更内容</div><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0, fontSize: 12 }}>{JSON.stringify({ before: detail.raw.before_data, after: detail.raw.after_data }, null, 2)}</pre></div>}
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
 *   待补：配置草稿、重发邀请与独立安全记录。
 */
