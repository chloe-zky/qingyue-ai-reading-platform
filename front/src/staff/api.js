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
  const role = ROLE_FROM_BACKEND[log.actor_role];
  return role ? ROLES[role].name : (log.actor_user_id ? '内部员工' : '系统');
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
  return {
    id: log.id,
    t: formatDateTime(log.created_at),
    who: actorLabel(log),
    mod: ({ editorial: '编辑配置', review: '审稿' })[log.domain] || log.domain,
    act: log.action,
    ver: log.resource_id || '—',
    note: log.summary || '—',
    result: log.result === 'failure' ? '失败' : '成功',
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
  updateStaff: (id, body) => api.patch(`/api/platform/staff/${encodeURIComponent(id)}`, body),
  platformLogs: () => api.get('/api/platform/audit-logs'),
  editorialOverview: () => api.get('/api/editorial/overview'),
  prompts: () => api.get('/api/editorial/prompts'),
  vocabularyVersions: () => api.get('/api/editorial/vocabulary/versions'),
  strategies: () => api.get('/api/editorial/strategies'),
  editorialLogs: () => api.get('/api/editorial/audit-logs'),
  submissions: () => api.get('/api/editor/submissions'),
  reviewConfigSummary: () => api.get('/api/editor/config-summary'),
  reviewLogs: () => api.get('/api/editor/audit-logs'),
};
