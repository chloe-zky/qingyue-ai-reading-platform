from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Callable, Optional

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.database import supabase
from app.utils.retry import retry_transport


class StaffRole(str, Enum):
    PLATFORM_ADMIN = "platform_admin"
    EDITORIAL_LEAD = "editorial_lead"
    REVIEW_EDITOR = "review_editor"


@dataclass(frozen=True)
class StaffPrincipal:
    user_id: str
    email: str
    display_name: str
    role: StaffRole


bearer_scheme = HTTPBearer(auto_error=False)


def _unauthorized(detail: str = "登录已失效，请重新登录") -> HTTPException:
    return HTTPException(
        status_code=401,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _load_auth_user(access_token: str):
    """Ask Supabase Auth to validate the access token and return its user."""
    try:
        response = retry_transport(lambda: supabase.auth.get_user(access_token))
    except Exception as exc:
        raise _unauthorized() from exc

    user = getattr(response, "user", None)
    if user is None or not getattr(user, "id", None):
        raise _unauthorized()
    return user


def _load_staff_profile(user_id: str) -> dict:
    try:
        response = retry_transport(lambda: (
            supabase.table("staff_profiles")
            .select("user_id,display_name,role,status")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        ))
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="员工权限服务暂不可用，请稍后重试",
        ) from exc

    rows = response.data or []
    if not rows:
        raise HTTPException(status_code=403, detail="当前账号没有内部工作台权限")

    profile = rows[0]
    if profile.get("status") != "active":
        raise HTTPException(status_code=403, detail="当前员工账号已被禁用")
    return profile


def get_current_staff(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> StaffPrincipal:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized("缺少登录凭证")

    user = _load_auth_user(credentials.credentials)
    user_id = str(user.id)
    profile = _load_staff_profile(user_id)

    try:
        role = StaffRole(profile.get("role"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=403, detail="员工账号角色配置无效") from exc

    return StaffPrincipal(
        user_id=user_id,
        email=getattr(user, "email", "") or "",
        display_name=(profile.get("display_name") or "").strip(),
        role=role,
    )


def require_roles(*allowed_roles: StaffRole) -> Callable:
    allowed = frozenset(allowed_roles)
    if not allowed:
        raise ValueError("require_roles 至少需要一个角色")

    def dependency(
        principal: StaffPrincipal = Depends(get_current_staff),
    ) -> StaffPrincipal:
        if principal.role not in allowed:
            raise HTTPException(status_code=403, detail="当前账号无权执行此操作")
        return principal

    return dependency


require_platform_admin = require_roles(StaffRole.PLATFORM_ADMIN)
require_editorial_lead = require_roles(StaffRole.EDITORIAL_LEAD)
require_review_editor = require_roles(StaffRole.REVIEW_EDITOR)
