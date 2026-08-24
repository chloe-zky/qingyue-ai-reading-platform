// constants.js — 角色、导航、状态字典。
// 取自 prototype-admin/shared.jsx 与 app.jsx，值逐字保持。
//
// 一处必要的落地映射：原型用 admin / lead / review 三个短 key，
// 后端 staff_profiles.role 用 platform_admin / editorial_lead / review_editor。
// 短 key 是设计语言的一部分（CSS 类名 .rolebadge.admin、主题选择等都依赖它），
// 因此保留短 key 作为界面内部标识，在边界处与后端角色互转。

import { STAFF_ROLES } from '../../auth/staffAuth';

export const ROLES = {
  admin:  { key: 'admin',  name: '平台管理员',   en: 'Platform Admin', theme: 'theme-tech', color: '#2E77A8' },
  lead:   { key: 'lead',   name: '编辑部负责人', en: 'Editorial Lead', theme: 'theme-lit',  color: '#8B3A2E' },
  review: { key: 'review', name: '审稿编辑',     en: 'Review Editor',  theme: 'theme-tech', color: '#2E8B6F' },
};

/** 后端角色 → 界面短 key */
export const ROLE_FROM_BACKEND = {
  [STAFF_ROLES.PLATFORM_ADMIN]: 'admin',
  [STAFF_ROLES.EDITORIAL_LEAD]: 'lead',
  [STAFF_ROLES.REVIEW_EDITOR]: 'review',
};

/** 界面短 key → 后端角色（邀请员工等需要回写时用） */
export const ROLE_TO_BACKEND = {
  admin: STAFF_ROLES.PLATFORM_ADMIN,
  lead: STAFF_ROLES.EDITORIAL_LEAD,
  review: STAFF_ROLES.REVIEW_EDITOR,
};

export const NAV = {
  admin: [
    { k: 'overview', name: '技术概览', icon: 'overview' },
    { k: 'llm', name: 'AI 服务配置', icon: 'llm' },
    { k: 'staff', name: '员工账号', icon: 'staff' },
    { k: 'health', name: '系统状态', icon: 'health' },
    { k: 'logs', name: '技术日志', icon: 'logs' },
  ],
  lead: [
    { k: 'eoverview', name: '编辑策略概览', icon: 'quill' },
    { k: 'prompt', name: 'Prompt 管理', icon: 'prompt' },
    { k: 'tags', name: '标签词表', icon: 'tags' },
    { k: 'reco', name: '推荐策略', icon: 'reco' },
    { k: 'sim', name: '策略模拟', icon: 'sim' },
    { k: 'editLogs', name: '编辑配置日志', icon: 'logs' },
  ],
  review: [
    { k: 'review', name: '审稿工作台', icon: 'doc' },
    { k: 'myReviews', name: '我的审稿记录', icon: 'logs' },
  ],
};

export const HOME = { admin: 'overview', lead: 'eoverview', review: 'review' };

/** 侧栏分组标题 */
export const NAV_LABEL = { admin: '技术与安全', lead: '内容与策略', review: '稿件审读' };

export const STAFF_STATUS = { active: ['ok', '在用'], invited: ['info', '待接受'], disabled: ['mute', '已禁用'] };
export const PROMPT_STATUS = { draft: ['warn', '草稿'], testing: ['info', '测试中'], published: ['ok', '已发布'], disabled: ['mute', '已停用'] };

/** 每个视图 key 允许的角色 —— PermissionGuard 在路由层用它拦截越权访问。 */
export const VIEW_ROLES = {
  overview: ['admin'], llm: ['admin'], staff: ['admin'], health: ['admin'], logs: ['admin'],
  eoverview: ['lead'], prompt: ['lead'], tags: ['lead'], reco: ['lead'], sim: ['lead'], editLogs: ['lead'],
  review: ['review'], myReviews: ['review'],
};

export const delay = (ms) => new Promise((r) => setTimeout(r, ms));
