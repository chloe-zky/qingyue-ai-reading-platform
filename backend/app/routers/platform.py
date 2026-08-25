from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.schemas.platform import (
    InviteStaffRequest,
    InviteStaffResponse,
    StaffAccountResponse,
    StaffListResponse,
    StorageHealthResponse,
    UpdateStaffRequest,
)
from app.services.audit_service import write_audit_log
from app.schemas.editorial import AuditLogResponse
from app.services.audit_service import list_audit_logs
from app.services.platform_service import (
    StaffAccountConflictError,
    StaffAccountNotFoundError,
    StorageHealthError,
    check_storage_health,
    invite_staff_account,
    list_staff_accounts,
    update_staff_account,
)
from app.utils.auth import StaffPrincipal, require_platform_admin


router = APIRouter(prefix="/api/platform", tags=["Platform"])
logger = logging.getLogger(__name__)


@router.get("/storage-health", response_model=StorageHealthResponse)
def get_storage_health(
    principal: StaffPrincipal = Depends(require_platform_admin),
) -> StorageHealthResponse:
    try:
        return StorageHealthResponse(**check_storage_health())
    except StorageHealthError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception:
        logger.exception("检查文件存储状态失败")
        raise HTTPException(status_code=500, detail="文件存储检查失败，请稍后重试。")


@router.get("/audit-logs", response_model=list[AuditLogResponse])
def get_platform_audit_logs(
    q: Optional[str] = Query(default=None, max_length=100),
    result: Optional[Literal["success", "failure"]] = Query(default=None),
    domain: Optional[Literal["platform", "auth", "security"]] = Query(default=None),
    hours: int = Query(default=24, ge=1, le=744),
    limit: int = Query(default=100, ge=1, le=500),
    principal: StaffPrincipal = Depends(require_platform_admin),
):
    try:
        return list_audit_logs(
            domains=[domain] if domain else ["platform", "auth", "security"],
            search=q,
            result=result,
            created_after=(
                datetime.now(timezone.utc) - timedelta(hours=hours)
                if hours
                else None
            ),
            limit=limit,
        )
    except Exception:
        logger.exception("读取平台审计日志失败")
        raise HTTPException(status_code=500, detail="平台审计日志读取失败，请稍后重试。")


@router.get("/staff", response_model=StaffListResponse)
def get_staff_accounts(
    limit: int = Query(default=200, ge=1, le=500),
    principal: StaffPrincipal = Depends(require_platform_admin),
) -> StaffListResponse:
    try:
        return StaffListResponse(staff=list_staff_accounts(limit))
    except Exception:
        logger.exception("读取员工账号失败")
        raise HTTPException(status_code=500, detail="员工账号读取失败，请稍后重试。")


@router.post("/staff/invitations", response_model=InviteStaffResponse, status_code=201)
def invite_staff(
    request: InviteStaffRequest,
    principal: StaffPrincipal = Depends(require_platform_admin),
) -> InviteStaffResponse:
    try:
        staff = invite_staff_account(request, principal)
        write_audit_log(
            principal,
            domain="auth",
            action="staff.invite",
            resource_type="staff_profile",
            resource_id=staff["user_id"],
            summary=f"邀请 {request.role.value} 员工账号",
            after_data={
                "display_name": staff["display_name"],
                "role": staff["role"],
                "status": staff["status"],
            },
        )
        return InviteStaffResponse(
            message="邀请已发送，员工角色已分配。",
            staff=StaffAccountResponse(**staff),
        )
    except StaffAccountConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except RuntimeError as exc:
        logger.exception("邀请员工后写入角色失败")
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception:
        logger.exception("邀请员工失败")
        raise HTTPException(status_code=500, detail="员工邀请失败，请稍后重试。")


@router.patch("/staff/{user_id}", response_model=StaffAccountResponse)
def update_staff(
    user_id: str,
    request: UpdateStaffRequest,
    principal: StaffPrincipal = Depends(require_platform_admin),
) -> StaffAccountResponse:
    try:
        before, staff = update_staff_account(user_id, request, principal)
        write_audit_log(
            principal,
            domain="auth",
            action="staff.update",
            resource_type="staff_profile",
            resource_id=user_id,
            summary="更新员工账号角色或状态",
            before_data={
                "display_name": before.get("display_name"),
                "role": before.get("role"),
                "status": before.get("status"),
            },
            after_data={
                "display_name": staff["display_name"],
                "role": staff["role"],
                "status": staff["status"],
            },
        )
        return StaffAccountResponse(**staff)
    except StaffAccountNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except StaffAccountConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception:
        logger.exception("更新员工账号失败: user_id=%s", user_id)
        raise HTTPException(status_code=500, detail="员工账号更新失败，请稍后重试。")
