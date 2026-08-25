from __future__ import annotations

import time
from datetime import datetime
from typing import Any

from app.database import supabase
from app.schemas.platform import InviteStaffRequest, UpdateStaffRequest
from app.utils.auth import StaffPrincipal, StaffRole


class StaffAccountNotFoundError(ValueError):
    pass


class StaffAccountConflictError(ValueError):
    pass


class StorageHealthError(RuntimeError):
    pass


def _value(item: Any, name: str, default=None):
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def _iso_or_value(value):
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _auth_users_by_id() -> dict[str, Any]:
    users = supabase.auth.admin.list_users(page=1, per_page=1000) or []
    return {str(_value(user, "id")): user for user in users if _value(user, "id")}


def _merge_staff_profile(profile: dict, auth_user=None) -> dict:
    return {
        "user_id": str(profile["user_id"]),
        "email": (_value(auth_user, "email", "") or "").strip(),
        "display_name": (profile.get("display_name") or "").strip(),
        "role": profile["role"],
        "status": profile["status"],
        "created_at": _iso_or_value(profile.get("created_at")),
        "updated_at": _iso_or_value(profile.get("updated_at")),
        "last_sign_in_at": _iso_or_value(
            _value(auth_user, "last_sign_in_at") if auth_user else None
        ),
    }


def list_staff_accounts(limit: int = 200) -> list[dict]:
    safe_limit = max(1, min(limit, 500))
    response = (
        supabase.table("staff_profiles")
        .select("user_id,display_name,role,status,created_at,updated_at")
        .order("created_at", desc=False)
        .limit(safe_limit)
        .execute()
    )
    profiles = response.data or []
    auth_users = _auth_users_by_id()
    return [
        _merge_staff_profile(profile, auth_users.get(str(profile["user_id"])))
        for profile in profiles
    ]


def invite_staff_account(request: InviteStaffRequest, actor: StaffPrincipal) -> dict:
    try:
        invited = supabase.auth.admin.invite_user_by_email(request.email)
    except Exception as exc:
        raise StaffAccountConflictError(
            "邀请发送失败；该邮箱可能已存在，请改为给现有 Auth 用户分配角色。"
        ) from exc

    user = _value(invited, "user")
    user_id = _value(user, "id")
    if not user_id:
        raise RuntimeError("Supabase 已接受邀请，但没有返回用户 ID。")

    payload = {
        "user_id": str(user_id),
        "display_name": request.display_name,
        "role": request.role.value,
        "status": "active",
        "created_by": actor.user_id,
    }
    try:
        response = (
            supabase.table("staff_profiles")
            .upsert(payload, on_conflict="user_id")
            .execute()
        )
    except Exception as exc:
        # Auth 中留下一个没有 staff profile 的邀请账号是安全失败：它能登录，
        # 但 /api/internal/me 会返回 403，平台管理员可稍后补分配。
        raise RuntimeError(
            "邀请已发送，但员工角色写入失败；该账号目前没有内部权限。"
        ) from exc

    profile = (response.data or [payload])[0]
    return _merge_staff_profile(profile, user)


def _get_staff_profile(user_id: str) -> dict:
    response = (
        supabase.table("staff_profiles")
        .select("user_id,display_name,role,status,created_at,updated_at")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not response.data:
        raise StaffAccountNotFoundError("找不到该员工账号")
    return response.data[0]


def _active_platform_admin_count() -> int:
    response = (
        supabase.table("staff_profiles")
        .select("user_id")
        .eq("role", StaffRole.PLATFORM_ADMIN.value)
        .eq("status", "active")
        .execute()
    )
    return len(response.data or [])


def update_staff_account(
    user_id: str,
    request: UpdateStaffRequest,
    actor: StaffPrincipal,
) -> tuple[dict, dict]:
    current = _get_staff_profile(user_id)
    changes = request.model_dump(exclude_none=True)
    if "role" in changes:
        changes["role"] = request.role.value

    changes = {
        key: value
        for key, value in changes.items()
        if current.get(key) != value
    }
    if not changes:
        auth_user = _auth_users_by_id().get(user_id)
        return current, _merge_staff_profile(current, auth_user)

    changes_identity = "role" in changes or "status" in changes
    if user_id == actor.user_id and changes_identity:
        raise StaffAccountConflictError("不能修改自己的角色或停用自己的账号")

    removes_active_platform_admin = (
        current.get("role") == StaffRole.PLATFORM_ADMIN.value
        and current.get("status") == "active"
        and (
            changes.get("role", current.get("role"))
            != StaffRole.PLATFORM_ADMIN.value
            or changes.get("status", current.get("status")) != "active"
        )
    )
    if removes_active_platform_admin and _active_platform_admin_count() <= 1:
        raise StaffAccountConflictError("系统必须至少保留一个启用的平台管理员")

    response = (
        supabase.table("staff_profiles")
        .update(changes)
        .eq("user_id", user_id)
        .execute()
    )
    if not response.data:
        raise StaffAccountConflictError("员工账号状态已变化，请刷新后重试")

    updated = response.data[0]
    auth_user = _auth_users_by_id().get(user_id)
    return current, _merge_staff_profile(updated, auth_user)


def check_storage_health(bucket_name: str = "covers") -> dict:
    """Verify Storage API access without reading or writing any uploaded object."""
    started = time.perf_counter()
    try:
        buckets = supabase.storage.list_buckets() or []
    except Exception as error:
        raise StorageHealthError("文件存储服务不可用，请检查 Supabase 项目状态。") from error

    names = {
        str(_value(bucket, "name", ""))
        for bucket in buckets
        if _value(bucket, "name", "")
    }
    if bucket_name not in names:
        raise StorageHealthError(f"文件存储缺少 {bucket_name} bucket。")

    return {
        "status": "ok",
        "bucket": bucket_name,
        "latency_ms": max(0, round((time.perf_counter() - started) * 1000)),
        "message": f"Supabase Storage 与 {bucket_name} bucket 可访问。",
    }
