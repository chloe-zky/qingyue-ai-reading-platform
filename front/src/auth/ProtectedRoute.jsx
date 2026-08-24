// ProtectedRoute.jsx — 「必须是已登录且具备内部角色的员工」这一条门槛。
//
// 刻意不含任何视觉：把非通过态交给 fallback 渲染，样式全部归 staff/ 层所有。
// 这样以后换设计稿时不用碰鉴权逻辑，也不会在 auth/ 里沉淀出第二套 UI。

import { AUTH_STATUS, useStaffAuth } from './staffAuth';

/**
 * @param {(ctx: {status, error, retry, signOut}) => React.ReactNode} fallback
 *        非 authenticated 时渲染什么（登录页 / 加载态 / 无权页 / 重试页）
 */
export default function ProtectedRoute({ children, fallback }) {
  const { status, error, retry, signOut } = useStaffAuth();

  if (status === AUTH_STATUS.AUTHENTICATED) return children;
  return fallback ? fallback({ status, error, retry, signOut }) : null;
}
