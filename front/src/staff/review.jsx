// review.jsx — 审稿编辑工作台（权限补充 · 复用现有审稿闭环）
// DOM / 类名 / 文案 / 内联样式逐字移植自 prototype-admin/review.jsx。
//
// 一处落地改动：原型的「进入审稿」是 window.open('审稿编辑部 网页版.html')，
// 那是原型自己的静态文件。生产里审稿闭环是项目已有的 EditorPage（front/src/editor），
// 因此改为调用 ctx.openReview() —— 由挂载 InternalApp 的宿主决定如何切过去，
// 本模块不直接引用 EditorPage，避免把两套外壳耦合在一起。

import { useCallback, useEffect, useState } from 'react';
import Icon from './shared/Icon';
import { staffApi, errorMessage, toUiReviewLog, toUiSubmission, versionLabel } from './api';
import { Spin, StatusBadge, VersionBadge, EmptyState, ErrorState, LoadingState } from './shared/ui';

export function ReviewWorkspace({ ctx }) {
  const [refreshing, setRefreshing] = useState(false);
  const [queue, setQueue] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const loadWorkspace = useCallback(async (notify = false) => {
    setLoadError('');
    const [submissions, summary] = await Promise.all([
      staffApi.submissions(), staffApi.reviewConfigSummary(),
    ]);
    setQueue(submissions.map(toUiSubmission));
    setConfig(summary);
    if (notify) ctx.push('待审列表与生效配置已刷新', 'ok');
  }, [ctx]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadWorkspace().catch((error) => setLoadError(errorMessage(error, '审稿工作台读取失败。'))).finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(timer);
  }, [loadWorkspace]);

  async function refresh() {
    setRefreshing(true);
    try { await loadWorkspace(true); }
    catch (error) { setLoadError(errorMessage(error)); ctx.push(errorMessage(error), 'err'); }
    finally { setRefreshing(false); }
  }
  function openFull() { ctx.openReview(); }
  return (
    <div className="page wide fade-in">
      <div className="phead">
        <div><div className="eyebrow">— Review Workspace —</div><h1>审稿工作台</h1><p className="lead">审读、初审与收稿的完整闭环沿用现有审稿界面。此处为进入闭环的权限化入口与只读参照。</p></div>
        <div className="pactions">
          <button className="btn ghost" onClick={() => ctx.go('myReviews')}><Icon id="doc" size={14} className="btn-ico" />查看我的审稿记录</button>
          <button className="btn" onClick={refresh} disabled={refreshing}>{refreshing ? <><Spin />刷新中…</> : <><Icon id="refresh" size={14} className="btn-ico" />刷新待审列表</>}</button>
        </div>
      </div>

      {loading && <div className="card"><LoadingState rows={4} /></div>}
      {!loading && loadError && <div className="card"><ErrorState desc={loadError} onRetry={refresh} /></div>}

      {/* 当前生效配置：只读展示，审稿编辑不可修改 */}
      <div className="card">
        <div className="card-h"><div><div className="ct">当前生效配置<span style={{ marginLeft: 10 }}><StatusBadge kind="mute"><Icon id="lock" size={11} style={{ marginRight: 2 }} />只读</StatusBadge></span></div><div className="csub">审稿时依据以下已发布版本，如需调整请联系编辑部负责人。</div></div></div>
        <div className="ro-strip">
          <div className="rs"><div className="rs-k"><Icon id="prompt" size={11} />Prompt 版本</div><div className="rs-v"><VersionBadge v={versionLabel(config?.prompt_version)} /> 当前发布版本</div></div>
          <div className="rs"><div className="rs-k"><Icon id="tags" size={11} />标签词表</div><div className="rs-v"><VersionBadge v={versionLabel(config?.tag_vocabulary_version)} /> 当前发布版本</div></div>
          <div className="rs"><div className="rs-k"><Icon id="reco" size={11} />推荐策略</div><div className="rs-v"><VersionBadge v={versionLabel(config?.strategy_version)} /> 当前发布版本</div></div>
        </div>
      </div>

      {/* 待审队列 */}
      <div className="card pad0">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--rule)' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15 }}>我的待审队列 <span className="muted numf" style={{ fontSize: 14 }}>· {queue.length}</span></div>
          <span className="muted" style={{ fontSize: 12 }}>真实数据 · 并发冲突由审稿提交接口返回 409</span>
        </div>
        {queue.length ? <table className="tbl"><thead><tr><th>编号</th><th>稿件</th><th>作者</th><th>字数</th><th>提交</th><th>阶段</th><th style={{ textAlign: 'right' }}>操作</th></tr></thead><tbody>
          {queue.map((q) => <tr key={q.id}><td className="t-mono">{q.id}</td><td className="t-name">{q.title}</td><td>{q.author}</td><td className="t-sub">{q.words}</td><td className="t-mono">{q.at}</td><td><StatusBadge kind={q.stage === '待初审' ? 'info' : 'warn'}>{q.stage}</StatusBadge></td><td style={{ textAlign: 'right' }}><button className="btn sm" onClick={openFull}>进入审稿</button></td></tr>)}
        </tbody></table> : <EmptyState title="暂无待审稿件" desc="新的投稿到达后会出现在这里。" />}
      </div>

      {/* 保留的审稿动作说明（真实操作在审稿界面内） */}
      <div className="card">
        <div className="card-h"><div className="ct">闭环内保留的操作</div></div>
        <div className="card-hint">以下动作在「进入审稿」后的稿件详情内完成，行为与现有审稿界面一致：</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['拒稿', '提交修改意见', '通过初审', '保存标签调整', '确认收稿并进入推荐池', '返回待审列表'].map((t) => <span key={t} className="badge mute" style={{ fontSize: 12.5, padding: '6px 12px' }}>{t}</span>)}
        </div>
        <hr className="sep" />
        <div className="banner mute" style={{ background: 'var(--panel-2)', borderColor: 'var(--rule)', color: 'var(--ink-2)' }}><span className="bd" style={{ background: 'var(--ink-4)' }} /><span className="bx">审稿编辑不可见：AI 配置、员工账号、Prompt / 词表 / 推荐策略的编辑入口。仅可读取已发布版本。</span></div>
      </div>

    </div>
  );
}

export function MyReviewHistory({ ctx }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const loadHistory = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { setRows((await staffApi.reviewLogs()).map(toUiReviewLog)); }
    catch (error) { setLoadError(errorMessage(error, '审稿记录读取失败。')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(loadHistory, 0);
    return () => clearTimeout(timer);
  }, [loadHistory]);
  const R = { ok: ['ok', '通过'], warn: ['warn', '退回'], err: ['err', '拒稿'] };
  return (
    <div className="page wide fade-in">
      <div className="phead"><div><button className="btn ghost sm" onClick={() => ctx.go('review')} style={{ marginBottom: 12 }}>← 返回审稿工作台</button><div className="eyebrow">— My Reviews —</div><h1>我的审稿记录</h1><p className="lead">你近期处理过的稿件与决定。</p></div></div>
      <div className="card pad0">
        {loading && <LoadingState rows={4} />}
        {!loading && loadError && <ErrorState desc={loadError} onRetry={loadHistory} />}
        {!loading && !loadError && rows.length === 0 && <EmptyState title="暂无审稿记录" desc="完成审稿决定后会在这里留下记录。" />}
        {!loading && !loadError && rows.length > 0 && <table className="tbl"><thead><tr><th>编号</th><th>稿件</th><th>我的决定</th><th>时间</th><th style={{ textAlign: 'right' }}>结果</th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}><td className="t-mono">{r.id}</td><td className="t-name">{r.title}</td><td>{r.act}</td><td className="t-mono">{r.at}</td><td style={{ textAlign: 'right' }}><StatusBadge kind={R[r.result][0]}>{R[r.result][1]}</StatusBadge></td></tr>)}
        </tbody></table>}
      </div>
    </div>
  );
}

/* 接口状态：
 *   已接入：待审队列、当前生效配置只读汇总、当前审稿编辑的审计记录。
 *   待补：稿件认领/占用语义；审稿决定提交阶段已有 409 状态冲突保护。
 */
