import logging

from fastapi import APIRouter, Depends, HTTPException
from app.utils.auth import StaffPrincipal, require_review_editor
from app.schemas.tag import TagsSchema
from app.services.gemini_service import extract_tags_for_book
from app.services.tag_service import confirm_book_tags

router = APIRouter(prefix="/api/books", tags=["Tags"])
logger = logging.getLogger(__name__)

@router.post("/{book_id}/extract-tags")
def api_extract_tags(
    book_id: int,
    principal: StaffPrincipal = Depends(require_review_editor),
):
    try:
        tags = extract_tags_for_book(book_id)
        return {"message": "AI 标签提取完成", "draft_tags": tags}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError:
        logger.exception("AI 标签提取失败: book_id=%s", book_id)
        raise HTTPException(status_code=502, detail="AI 标签提取失败，请稍后重试。")
    except Exception:
        logger.exception("标签提取发生未预期错误: book_id=%s", book_id)
        raise HTTPException(status_code=500, detail="标签提取失败，请稍后重试。")

@router.post("/{book_id}/confirm-tags")
def api_confirm_tags(
    book_id: int,
    req: TagsSchema,
    principal: StaffPrincipal = Depends(require_review_editor),
):
    try:
        confirm_book_tags(book_id, req)
        return {"message": "标签审核确认成功"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception:
        logger.exception("标签确认失败: book_id=%s", book_id)
        raise HTTPException(status_code=500, detail="标签确认失败，请稍后重试。")
