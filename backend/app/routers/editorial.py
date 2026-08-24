import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from app.schemas.editorial import (
    AuditLogResponse,
    EditorialOverviewResponse,
    EditorialPromptSummary,
    EditorialStrategySummary,
    VocabularyVersionSummary,
)
from app.services.audit_service import list_audit_logs
from app.services.editorial_service import (
    get_editorial_overview,
    list_editorial_prompts,
    list_editorial_strategies,
    list_vocabulary_versions,
)
from app.utils.auth import StaffPrincipal, require_editorial_lead


router = APIRouter(prefix="/api/editorial", tags=["Editorial"])
logger = logging.getLogger(__name__)


def _internal_read(operation, message: str):
    try:
        return operation()
    except Exception:
        logger.exception(message)
        raise HTTPException(status_code=500, detail="编辑配置读取失败，请稍后重试。")


@router.get("/overview", response_model=EditorialOverviewResponse)
def editorial_overview(
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_read(get_editorial_overview, "读取编辑策略概览失败")


@router.get("/prompts", response_model=list[EditorialPromptSummary])
def editorial_prompts(
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_read(list_editorial_prompts, "读取 Prompt 列表失败")


@router.get(
    "/vocabulary/versions", response_model=list[VocabularyVersionSummary]
)
def editorial_vocabulary_versions(
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_read(list_vocabulary_versions, "读取标签词表版本失败")


@router.get("/strategies", response_model=list[EditorialStrategySummary])
def editorial_strategies(
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_read(list_editorial_strategies, "读取推荐策略失败")


@router.get("/audit-logs", response_model=list[AuditLogResponse])
def editorial_audit_logs(
    limit: int = Query(default=100, ge=1, le=500),
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_read(
        lambda: list_audit_logs(domains=["editorial", "review"], limit=limit),
        "读取编辑审计日志失败",
    )

