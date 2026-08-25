// 内部后台的真实 API 边界与数据适配。
// 组件继续使用设计稿的短字段，所有后端字段/角色转换集中在这里。

import { api } from '../lib/apiClient';
import { ROLE_FROM_BACKEND, ROLE_TO_BACKEND, ROLES } from './shared/constants';

export function formatDateTime(value, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date).replaceAll('/', '-');
}

export function versionLabel(value) {
  return Number.isInteger(value) ? `v${value}` : '—';
}

export function errorMessage(error, fallback = '加载失败，请稍后重试。') {
  return error?.detail || error?.message || fallback;
}

export function toUiStaff(item) {
  return {
    id: item.user_id,
    name: item.display_name || item.email || '未命名员工',
    email: item.email || '',
    role: ROLE_FROM_BACKEND[item.role] || 'review',
    status: item.status || 'disabled',
    last: formatDateTime(item.last_sign_in_at),
    created: formatDateTime(item.created_at),
  };
}

function actorLabel(log) {
  if (log.actor_display_name) return log.actor_display_name;
  const role = ROLE_FROM_BACKEND[log.actor_role];
  return role ? ROLES[role].name : (log.actor_user_id ? '内部员工' : '系统');
}

function queryString(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  const suffix = query.toString();
  return suffix ? `?${suffix}` : '';
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  // Prevent spreadsheet programs from interpreting untrusted log text as a formula.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function downloadCsv(filename, columns, rows) {
  const lines = [
    columns.map((column) => csvCell(column.label)).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column.key])).join(',')),
  ];
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function toUiTechnicalLog(log) {
  const failed = log.result === 'failure';
  return {
    id: log.id,
    t: formatDateTime(log.created_at),
    lvl: failed ? 'error' : 'info',
    mod: ({ platform: '平台配置', auth: '账号', security: '安全' })[log.domain] || log.domain,
    who: actorLabel(log),
    act: log.summary || log.action,
    result: failed ? '失败' : '成功',
    raw: log,
  };
}

export function toUiEditorialLog(log) {
  const actionLabel = ({
    'config.bootstrap.publish': '发布',
    'prompt.draft.save': '保存 Prompt 草稿',
    'prompt.publish': '发布 Prompt',
    'prompt.rollback': '回滚 Prompt',
    'vocabulary.draft.create': '创建词表草稿',
    'vocabulary.term.update': '修改词条',
    'vocabulary.publish': '发布词表',
    'vocabulary.rollback': '回滚词表',
    'strategy.draft.save': '保存策略草稿',
    'strategy.publish': '发布策略',
    'strategy.rollback': '回滚策略',
  })[log.action] || log.action;
  return {
    id: log.id,
    t: formatDateTime(log.created_at),
    who: actorLabel(log),
    mod: ({ editorial: '编辑配置', review: '审稿' })[log.domain] || log.domain,
    act: actionLabel,
    ver: log.resource_id || '—',
    note: log.summary || '—',
    result: log.result === 'failure' ? '失败' : '成功',
    raw: log,
  };
}

function contentStatus(item) {
  if (item.status === 'disabled') return 'disabled';
  if (item.latest_draft_version != null) return 'draft';
  if (item.published_version != null) return 'published';
  return 'draft';
}

export function toUiPrompt(item) {
  return {
    id: item.id,
    name: item.name,
    scene: item.use_case,
    live: versionLabel(item.published_version),
    draft: item.latest_draft_version == null ? null : versionLabel(item.latest_draft_version),
    status: contentStatus(item),
    at: formatDateTime(item.updated_at),
    by: item.description || '—',
    promptKey: item.prompt_key,
  };
}

export function toUiStrategy(item) {
  const version = item.latest_draft_version ?? item.published_version;
  return {
    id: item.id,
    name: item.name,
    scene: item.use_case,
    ver: versionLabel(version),
    status: contentStatus(item),
    at: formatDateTime(item.updated_at),
    by: item.description || '—',
    strategyKey: item.strategy_key,
  };
}

export function toUiSubmission(item) {
  const content = item.full_content || item.sample || '';
  return {
    id: `QY-${item.book_id}`,
    bookId: item.book_id,
    title: item.title || '未命名稿件',
    author: item.author || '匿名作者',
    words: content ? `${content.length} 字` : '—',
    at: '—',
    stage: item.tags?.tag_status === 'draft' ? '待初审' : '待复核',
    revisionNo: item.revision_no || 1,
    claimedByMe: Boolean(item.claimed_by_me),
    claimExpiresAt: item.review_claim_expires_at || null,
  };
}

export function toUiReviewLog(log) {
  const action = log.action || '';
  const result = action.includes('reject') ? 'err' : (action.includes('revision') ? 'warn' : 'ok');
  return {
    id: log.resource_id ? `QY-${log.resource_id}` : `LOG-${log.id}`,
    title: log.resource_id ? `稿件 #${log.resource_id}` : (log.summary || '审稿记录'),
    act: log.summary || action,
    at: formatDateTime(log.created_at),
    result,
  };
}

export const staffApi = {
  health: () => api.get('/api/health', { auth: false }),
  llmStatus: () => api.get('/api/platform/llm-config/status'),
  llmModels: (body) => {
    const payload = { ...body };
    if (!payload.api_key?.trim()) delete payload.api_key;
    return api.post('/api/platform/llm-config/models', payload);
  },
  testLlm: (body) => {
    const payload = { ...body, max_retries: 0 };
    if (!payload.api_key?.trim()) delete payload.api_key;
    return api.post('/api/platform/llm-config/test', payload);
  },
  saveLlm: (body) => {
    const payload = { ...body };
    // 各终端统一约定：密钥留空表示保留服务端已有密钥。
    if (!payload.api_key?.trim()) delete payload.api_key;
    return api.post('/api/platform/llm-config', payload);
  },
  staff: () => api.get('/api/platform/staff'),
  inviteStaff: (form) => api.post('/api/platform/staff/invitations', {
    display_name: form.name,
    email: form.email,
    role: ROLE_TO_BACKEND[form.role],
  }),
  updateStaff: (id, body) => api.patch(`/api/platform/staff/${encodeURIComponent(id)}`, {
    ...body,
    ...(ROLE_TO_BACKEND[body.role] ? { role: ROLE_TO_BACKEND[body.role] } : {}),
  }),
  platformLogs: (params = {}) => api.get(`/api/platform/audit-logs${queryString(params)}`),
  storageHealth: () => api.get('/api/platform/storage-health'),
  editorialOverview: () => api.get('/api/editorial/overview'),
  prompts: () => api.get('/api/editorial/prompts'),
  prompt: (id) => api.get(`/api/editorial/prompts/${encodeURIComponent(id)}`),
  savePromptDraft: (id, body) => api.post(`/api/editorial/prompts/${encodeURIComponent(id)}/draft`, body),
  testPrompt: (id, body) => api.post(`/api/editorial/prompts/${encodeURIComponent(id)}/test`, body),
  publishPrompt: (id, versionNo) => api.post(`/api/editorial/prompts/${encodeURIComponent(id)}/publish`, { version_no: versionNo }),
  rollbackPrompt: (id, targetVersionNo, changeNote = '') => api.post(`/api/editorial/prompts/${encodeURIComponent(id)}/rollback`, { target_version_no: targetVersionNo, change_note: changeNote }),
  vocabularyVersions: () => api.get('/api/editorial/vocabulary/versions'),
  vocabularyVersion: (id) => api.get(`/api/editorial/vocabulary/versions/${encodeURIComponent(id)}`),
  createVocabularyDraft: (changeNote = '') => api.post('/api/editorial/vocabulary/drafts', { change_note: changeNote }),
  updateVocabularyTerm: (versionId, termId, body) => api.patch(`/api/editorial/vocabulary/versions/${encodeURIComponent(versionId)}/terms/${encodeURIComponent(termId)}`, body),
  createVocabularyTerm: (versionId, categoryId, body) => api.post(`/api/editorial/vocabulary/versions/${encodeURIComponent(versionId)}/categories/${encodeURIComponent(categoryId)}/terms`, body),
  publishVocabulary: (versionId, versionNo) => api.post(`/api/editorial/vocabulary/versions/${encodeURIComponent(versionId)}/publish`, { version_no: versionNo }),
  rollbackVocabulary: (targetVersionNo, changeNote = '') => api.post('/api/editorial/vocabulary/rollback', { target_version_no: targetVersionNo, change_note: changeNote }),
  strategies: () => api.get('/api/editorial/strategies'),
  strategy: (id) => api.get(`/api/editorial/strategies/${encodeURIComponent(id)}`),
  saveStrategyDraft: (id, body) => api.post(`/api/editorial/strategies/${encodeURIComponent(id)}/draft`, body),
  simulateStrategy: (id, body) => api.post(`/api/editorial/strategies/${encodeURIComponent(id)}/simulate`, body),
  publishStrategy: (id, versionNo) => api.post(`/api/editorial/strategies/${encodeURIComponent(id)}/publish`, { version_no: versionNo }),
  rollbackStrategy: (id, targetVersionNo, changeNote = '') => api.post(`/api/editorial/strategies/${encodeURIComponent(id)}/rollback`, { target_version_no: targetVersionNo, change_note: changeNote }),
  editorialLogs: (params = {}) => api.get(`/api/editorial/audit-logs${queryString(params)}`),
  submissions: () => api.get('/api/editor/submissions'),
  claimSubmission: (bookId) => api.post(`/api/editor/submissions/${encodeURIComponent(bookId)}/claim`, {}),
  releaseSubmission: (bookId) => api.del(`/api/editor/submissions/${encodeURIComponent(bookId)}/claim`),
  reviewConfigSummary: () => api.get('/api/editor/config-summary'),
  reviewLogs: () => api.get('/api/editor/audit-logs'),
};
