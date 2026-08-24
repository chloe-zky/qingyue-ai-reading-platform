import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from app.schemas.editorial import AuditLogResponse, EditorialOverviewResponse
from app.services.audit_service import list_audit_logs, write_audit_log
from app.utils.auth import StaffPrincipal, require_review_editor
from app.schemas.editor import (
    ApproveArticleRequest,
    RejectArticleRequest,
    ReviseArticleRequest,
)
from app.services.editor_service import (
    SubmissionNotFoundError,
    SubmissionStateConflictError,
    approve_submission,
    get_pending_submissions,
    reject_submission,
    request_submission_revision,
)
from app.services.editorial_service import get_editorial_overview

router = APIRouter(prefix="/api/editor", tags=["Editor"])
logger = logging.getLogger(__name__)


@router.get("/audit-logs", response_model=list[AuditLogResponse])
def api_get_my_audit_logs(
    limit: int = Query(default=100, ge=1, le=500),
    principal: StaffPrincipal = Depends(require_review_editor),
):
    try:
        return list_audit_logs(
            domains=["review"],
            actor_user_id=principal.user_id,
            limit=limit,
        )
    except Exception:
        logger.exception("读取个人审稿记录失败")
        raise HTTPException(status_code=500, detail="审稿记录读取失败，请稍后重试。")


@router.get("/config-summary", response_model=EditorialOverviewResponse)
def api_get_active_config_summary(
    principal: StaffPrincipal = Depends(require_review_editor),
):
    """审稿编辑只读查看当前生效版本，不暴露配置正文与编辑入口。"""
    try:
        return get_editorial_overview()
    except Exception:
        logger.exception("读取审稿生效配置失败")
        raise HTTPException(status_code=500, detail="生效配置读取失败，请稍后重试。")

@router.get("/submissions")
def api_get_submissions(
    limit: int = Query(default=100, ge=1, le=200),
    principal: StaffPrincipal = Depends(require_review_editor),
):
    try:
        return get_pending_submissions(limit)
    except Exception:
        logger.exception("读取待审稿件失败")
        raise HTTPException(status_code=500, detail="读取待审稿件失败，请稍后重试。")

@router.post("/articles/{book_id}/approve")
def api_approve_submission(
    book_id: int,
    req: ApproveArticleRequest,
    principal: StaffPrincipal = Depends(require_review_editor),
):
    try:
        result = approve_submission(book_id, req)
        write_audit_log(
            principal,
            domain="review",
            action="submission.approve",
            resource_type="book",
            resource_id=book_id,
            summary="审核通过并进入推荐池",
            after_data={"article_status": result.get("article_status")},
        )
        return result
    except SubmissionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except SubmissionStateConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception:
        logger.exception("审核稿件失败: book_id=%s", book_id)
        raise HTTPException(status_code=500, detail="审核失败，请稍后重试。")


def _handle_editor_decision(book_id: int, operation):
    try:
        return operation()
    except SubmissionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except SubmissionStateConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        logger.exception("更新稿件审读决定失败: book_id=%s", book_id)
        raise HTTPException(status_code=500, detail="审读决定保存失败，请稍后重试。")


@router.post("/articles/{book_id}/reject")
def api_reject_submission(
    book_id: int,
    req: RejectArticleRequest,
    principal: StaffPrincipal = Depends(require_review_editor),
):
    result = _handle_editor_decision(
        book_id, lambda: reject_submission(book_id, req.reason)
    )
    write_audit_log(
        principal,
        domain="review",
        action="submission.reject",
        resource_type="book",
        resource_id=book_id,
        summary="拒绝稿件并反馈作者",
        after_data={"article_status": result.get("article_status")},
    )
    return result


@router.post("/articles/{book_id}/revise")
def api_request_submission_revision(
    book_id: int,
    req: ReviseArticleRequest,
    principal: StaffPrincipal = Depends(require_review_editor),
):
    result = _handle_editor_decision(
        book_id, lambda: request_submission_revision(book_id, req.note)
    )
    write_audit_log(
        principal,
        domain="review",
        action="submission.revision_requested",
        resource_type="book",
        resource_id=book_id,
        summary="退回稿件修改并反馈作者",
        after_data={"article_status": result.get("article_status")},
    )
    return result
