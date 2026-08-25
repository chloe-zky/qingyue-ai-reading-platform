from __future__ import annotations

import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.schemas.editorial import (
    AuditLogResponse,
    EditorialOverviewResponse,
    EditorialPromptDetail,
    EditorialPromptSummary,
    EditorialStrategyDetail,
    EditorialStrategySummary,
    PromptDraftRequest,
    PromptTestRequest,
    PromptTestResponse,
    PublishVersionRequest,
    RollbackVersionRequest,
    StrategyDraftRequest,
    StrategySimulationRequest,
    StrategySimulationResponse,
    VersionMutationResponse,
    VocabularyDraftRequest,
    VocabularyTermDetail,
    VocabularyTermCreateRequest,
    VocabularyTermUpdateRequest,
    VocabularyVersionDetail,
    VocabularyVersionSummary,
)
from app.services.audit_service import list_audit_logs
from app.services.editorial_service import (
    EditorialConfigConflictError,
    EditorialConfigNotFoundError,
    create_vocabulary_draft,
    create_vocabulary_term,
    get_editorial_prompt,
    get_editorial_overview,
    get_editorial_strategy,
    get_vocabulary_version,
    list_editorial_prompts,
    list_editorial_strategies,
    list_vocabulary_versions,
    publish_prompt_version,
    publish_strategy_version,
    publish_vocabulary_version,
    rollback_prompt_version,
    rollback_strategy_version,
    rollback_vocabulary_version,
    save_prompt_draft,
    save_strategy_draft,
    simulate_strategy,
    test_prompt_draft,
    update_vocabulary_term,
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


def _internal_mutation(operation, message: str):
    try:
        return operation()
    except EditorialConfigNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except EditorialConfigConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:
        # Postgres publication functions use exceptions for stale/non-draft versions.
        detail = str(exc)
        if any(word in detail.lower() for word in ("draft", "version", "版本", "草稿")):
            raise HTTPException(status_code=409, detail="配置状态已变化，请刷新后重试。")
        logger.exception(message)
        raise HTTPException(status_code=500, detail="编辑配置操作失败，请稍后重试。")


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


@router.get("/prompts/{prompt_id}", response_model=EditorialPromptDetail)
def editorial_prompt_detail(
    prompt_id: str,
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_read(
        lambda: get_editorial_prompt(prompt_id), "读取 Prompt 详情失败"
    )


@router.post(
    "/prompts/{prompt_id}/draft", response_model=VersionMutationResponse
)
def editorial_prompt_save_draft(
    prompt_id: str,
    request: PromptDraftRequest,
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_mutation(
        lambda: save_prompt_draft(prompt_id, request, principal),
        "保存 Prompt 草稿失败",
    )


@router.post(
    "/prompts/{prompt_id}/publish", response_model=VersionMutationResponse
)
def editorial_prompt_publish(
    prompt_id: str,
    request: PublishVersionRequest,
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_mutation(
        lambda: publish_prompt_version(prompt_id, request.version_no, principal),
        "发布 Prompt 失败",
    )


@router.post(
    "/prompts/{prompt_id}/rollback", response_model=VersionMutationResponse
)
def editorial_prompt_rollback(
    prompt_id: str,
    request: RollbackVersionRequest,
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_mutation(
        lambda: rollback_prompt_version(prompt_id, request, principal),
        "回滚 Prompt 失败",
    )


@router.post(
    "/prompts/{prompt_id}/test", response_model=PromptTestResponse
)
def editorial_prompt_test(
    prompt_id: str,
    request: PromptTestRequest,
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_mutation(
        lambda: test_prompt_draft(prompt_id, request, principal),
        "Prompt 试运行失败",
    )


@router.get(
    "/vocabulary/versions", response_model=list[VocabularyVersionSummary]
)
def editorial_vocabulary_versions(
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_read(list_vocabulary_versions, "读取标签词表版本失败")


@router.get(
    "/vocabulary/versions/{version_id}", response_model=VocabularyVersionDetail
)
def editorial_vocabulary_version_detail(
    version_id: str,
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_read(
        lambda: get_vocabulary_version(version_id), "读取标签词表详情失败"
    )


@router.post(
    "/vocabulary/drafts", response_model=VersionMutationResponse, status_code=201
)
def editorial_vocabulary_create_draft(
    request: VocabularyDraftRequest,
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_mutation(
        lambda: create_vocabulary_draft(request.change_note, principal),
        "创建标签词表草稿失败",
    )


@router.patch(
    "/vocabulary/versions/{version_id}/terms/{term_id}",
    response_model=VocabularyTermDetail,
)
def editorial_vocabulary_update_term(
    version_id: str,
    term_id: str,
    request: VocabularyTermUpdateRequest,
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_mutation(
        lambda: update_vocabulary_term(version_id, term_id, request, principal),
        "修改标签词条失败",
    )


@router.post(
    "/vocabulary/versions/{version_id}/categories/{category_id}/terms",
    response_model=VocabularyTermDetail,
    status_code=201,
)
def editorial_vocabulary_create_term(
    version_id: str,
    category_id: str,
    request: VocabularyTermCreateRequest,
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_mutation(
        lambda: create_vocabulary_term(
            version_id, category_id, request, principal
        ),
        "新增标签词条失败",
    )


@router.post(
    "/vocabulary/versions/{version_id}/publish",
    response_model=VersionMutationResponse,
)
def editorial_vocabulary_publish(
    version_id: str,
    request: PublishVersionRequest,
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_mutation(
        lambda: publish_vocabulary_version(
            version_id, request.version_no, principal
        ),
        "发布标签词表失败",
    )


@router.post(
    "/vocabulary/rollback", response_model=VersionMutationResponse
)
def editorial_vocabulary_rollback(
    request: RollbackVersionRequest,
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_mutation(
        lambda: rollback_vocabulary_version(
            request.target_version_no, request.change_note, principal
        ),
        "回滚标签词表失败",
    )


@router.get("/strategies", response_model=list[EditorialStrategySummary])
def editorial_strategies(
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_read(list_editorial_strategies, "读取推荐策略失败")


@router.get("/strategies/{strategy_id}", response_model=EditorialStrategyDetail)
def editorial_strategy_detail(
    strategy_id: str,
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_read(
        lambda: get_editorial_strategy(strategy_id), "读取推荐策略详情失败"
    )


@router.post(
    "/strategies/{strategy_id}/draft", response_model=VersionMutationResponse
)
def editorial_strategy_save_draft(
    strategy_id: str,
    request: StrategyDraftRequest,
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_mutation(
        lambda: save_strategy_draft(strategy_id, request, principal),
        "保存推荐策略草稿失败",
    )


@router.post(
    "/strategies/{strategy_id}/publish", response_model=VersionMutationResponse
)
def editorial_strategy_publish(
    strategy_id: str,
    request: PublishVersionRequest,
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_mutation(
        lambda: publish_strategy_version(
            strategy_id, request.version_no, principal
        ),
        "发布推荐策略失败",
    )


@router.post(
    "/strategies/{strategy_id}/rollback", response_model=VersionMutationResponse
)
def editorial_strategy_rollback(
    strategy_id: str,
    request: RollbackVersionRequest,
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_mutation(
        lambda: rollback_strategy_version(strategy_id, request, principal),
        "回滚推荐策略失败",
    )


@router.post(
    "/strategies/{strategy_id}/simulate",
    response_model=StrategySimulationResponse,
)
def editorial_strategy_simulate(
    strategy_id: str,
    request: StrategySimulationRequest,
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_mutation(
        lambda: simulate_strategy(strategy_id, request, principal),
        "模拟推荐策略失败",
    )


@router.get("/audit-logs", response_model=list[AuditLogResponse])
def editorial_audit_logs(
    q: Optional[str] = Query(default=None, max_length=100),
    result: Optional[Literal["success", "failure"]] = Query(default=None),
    domain: Optional[Literal["editorial", "review"]] = Query(default=None),
    action_prefix: Optional[Literal["prompt", "vocabulary", "strategy"]] = Query(
        default=None
    ),
    action_contains: Optional[
        Literal["publish", "rollback", "test", "save", "update"]
    ] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    principal: StaffPrincipal = Depends(require_editorial_lead),
):
    return _internal_read(
        lambda: list_audit_logs(
            domains=[domain] if domain else ["editorial", "review"],
            search=q,
            result=result,
            action_prefix=action_prefix,
            action_contains=action_contains,
            limit=limit,
        ),
        "读取编辑审计日志失败",
    )
