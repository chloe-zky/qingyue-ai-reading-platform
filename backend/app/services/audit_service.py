from __future__ import annotations

import logging
from datetime import datetime
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
    search: str | None = None,
    result: str | None = None,
    action_prefix: str | None = None,
    action_contains: str | None = None,
    created_after: datetime | None = None,
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
    if result:
        query = query.eq("result", result)
    if created_after:
        query = query.gte("created_at", created_after.isoformat())

    # Text filters also match the operator's display name, which lives in a
    # separate table. Fetch a bounded window first, enrich it, then filter.
    response = query.order("created_at", desc=True).limit(500).execute()
    logs = response.data or []

    actor_ids = list(
        dict.fromkeys(
            str(item["actor_user_id"])
            for item in logs
            if item.get("actor_user_id")
        )
    )
    names: dict[str, str] = {}
    if actor_ids:
        try:
            profile_response = (
                supabase.table("staff_profiles")
                .select("user_id,display_name")
                .in_("user_id", actor_ids)
                .execute()
            )
            names = {
                str(item["user_id"]): item.get("display_name") or ""
                for item in (profile_response.data or [])
            }
        except Exception:
            # Log access remains useful even if profile enrichment is temporarily
            # unavailable. Never fail the audit page only because a name is absent.
            logger.exception("审计日志操作人名称读取失败")

    search_text = (search or "").strip().casefold()
    prefix = (action_prefix or "").strip().casefold()
    action_text = (action_contains or "").strip().casefold()
    filtered: list[dict] = []
    for item in logs:
        enriched = dict(item)
        enriched["actor_display_name"] = names.get(
            str(item.get("actor_user_id") or "")
        ) or None
        action = str(item.get("action") or "").casefold()
        if prefix and not action.startswith(prefix):
            continue
        if action_text and action_text not in action:
            continue
        if search_text:
            searchable = " ".join(
                str(value or "")
                for value in (
                    enriched.get("summary"),
                    enriched.get("action"),
                    enriched.get("resource_id"),
                    enriched.get("actor_display_name"),
                    enriched.get("actor_role"),
                )
            ).casefold()
            if search_text not in searchable:
                continue
        filtered.append(enriched)
        if len(filtered) >= safe_limit:
            break
    return filtered
