// RoleGuard.jsx — 「已登录员工里，只有这些角色能看」这一层。
//
// 与 ProtectedRoute 分开：前者管「是不是员工」，后者管「是哪个角色」。
// 前端守卫只负责不把入口暴露给无权角色；真正的拒绝始终由后端
// require_roles(...) 与数据库 RLS 决定，二者缺一不可。

import { hasRole, useStaffAuth } from './staffAuth';

/**
 * @param {string[]} allow 允许的角色；留空表示任意已登录员工
 * @param {(ctx: {role, allow}) => React.ReactNode} [fallback] 无权时渲染什么
 */
export default function RoleGuard({ allow, children, fallback }) {
  const { staff } = useStaffAuth();

  if (hasRole(staff, allow)) return children;
  return fallback ? fallback({ role: staff?.role ?? null, allow }) : null;
}
