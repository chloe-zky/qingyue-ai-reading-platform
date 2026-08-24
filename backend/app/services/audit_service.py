from __future__ import annotations

import logging
from typing import Any

from app.database import supabase
from app.utils.auth import StaffPrincipal


logger = logging.getLogger(__name__)


def write_audit_log(
    principal: StaffPrincipal,
    *,
    domain: str,
    action: str,
    resource_type: str,
    resource_id: str | int | None = None,
    summary: str = "",
    before_data: dict[str, Any] | None = None,
    after_data: dict[str, Any] | None = None,
    result: str = "success",
) -> None:
    """Write a best-effort audit event without ever storing credentials or bodies."""
    payload = {
        "actor_user_id": principal.user_id,
        "actor_role": principal.role.value,
        "domain": domain,
        "action": action,
        "resource_type": resource_type,
        "resource_id": str(resource_id) if resource_id is not None else None,
        "summary": summary,
        "before_data": before_data,
        "after_data": after_data,
        "result": result,
    }
    try:
        supabase.table("audit_logs").insert(payload).execute()
    except Exception:
        # The primary operation has already succeeded. Record the failure locally so
        # operators can investigate without turning a valid editorial decision into 500.
        logger.exception(
            "审计日志写入失败: domain=%s action=%s resource=%s",
            domain,
            action,
            resource_id,
        )


def list_audit_logs(
    *,
    domains: list[str],
    actor_user_id: str | None = None,
    limit: int = 100,
) -> list[dict]:
    safe_limit = max(1, min(limit, 500))
    query = (
        supabase.table("audit_logs")
        .select(
            "id,actor_user_id,actor_role,domain,action,resource_type,"
            "resource_id,summary,before_data,after_data,result,created_at"
        )
        .in_("domain", domains)
    )
    if actor_user_id:
        query = query.eq("actor_user_id", actor_user_id)
    response = query.order("created_at", desc=True).limit(safe_limit).execute()
    return response.data or []
