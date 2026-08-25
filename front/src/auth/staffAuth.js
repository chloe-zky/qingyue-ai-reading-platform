// staffAuth.js — 三角色常量、鉴权 Context 与 useStaffAuth hook。
//
// 与组件分文件放置：eslint react-refresh/only-export-components 要求
// .jsx 文件只导出组件，Context 与 hook 放在 .js 里。
//
// 角色定义与 backend/migrations/20260820_staff_roles_and_editorial_config.sql
// 的 staff_profiles.role check 约束逐字对应，任何一侧改动都必须同步另一侧。

import { createContext, useContext } from 'react';

export const STAFF_ROLES = {
  PLATFORM_ADMIN: 'platform_admin',
  EDITORIAL_LEAD: 'editorial_lead',
  REVIEW_EDITOR: 'review_editor',
};

export const ROLE_LABELS = {
  [STAFF_ROLES.PLATFORM_ADMIN]: '平台管理员',
  [STAFF_ROLES.EDITORIAL_LEAD]: '主编',
  [STAFF_ROLES.REVIEW_EDITOR]: '审稿编辑',
};

/** 各角色职责一句话，用于登录后与无权页的说明文案。 */
export const ROLE_SCOPES = {
  [STAFF_ROLES.PLATFORM_ADMIN]: '负责技术配置：模型接入、密钥、服务健康与配额。不参与稿件与内容规则。',
  [STAFF_ROLES.EDITORIAL_LEAD]: '负责内容规则：Prompt 版本、标签词表、推荐策略的发布与回滚。',
  [STAFF_ROLES.REVIEW_EDITOR]: '负责稿件流转：初审收稿、退回修改、拒稿、配图与标签确认发布。',
};

/**
 * 会话状态机：
 *   loading       启动中 / 正在校验凭证
 *   unconfigured  缺少 VITE_SUPABASE_* 环境变量，无法登录
 *   anonymous     未登录
 *   authenticated 已登录且具备内部角色（staff 一定非空）
 *   forbidden     Supabase 登录成功但没有 staff_profile 或账号已禁用
 *   unavailable   员工权限服务暂不可用（503），可重试
 */
export const AUTH_STATUS = {
  LOADING: 'loading',
  UNCONFIGURED: 'unconfigured',
  ANONYMOUS: 'anonymous',
  AUTHENTICATED: 'authenticated',
  FORBIDDEN: 'forbidden',
  UNAVAILABLE: 'unavailable',
};

export const STAFF_AUTH_ACTION = {
  INVITE: 'invite',
  RECOVERY: 'recovery',
};

export const StaffAuthContext = createContext(null);

export function useStaffAuth() {
  const ctx = useContext(StaffAuthContext);
  if (!ctx) throw new Error('useStaffAuth 必须在 <StaffAuthProvider> 内使用');
  return ctx;
}

/** 当前会话是否具备给定角色之一。allowed 为空表示「任意已登录员工」。 */
export function hasRole(staff, allowed) {
  if (!staff) return false;
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(staff.role);
}
