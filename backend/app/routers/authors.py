import logging

from fastapi import APIRouter, File, HTTPException, UploadFile
from app.schemas.author import AuthorArticleCreate, AuthorStatusBatchRequest
from app.services.author_service import (
    AuthorReceiptError,
    AuthorSubmissionStateConflictError,
    extract_docx_text,
    get_article_status,
    list_author_articles,
    read_manuscript_upload,
    submit_article_for_author,
)

router = APIRouter(prefix="/api/author", tags=["Author"])
logger = logging.getLogger(__name__)

@router.post("/articles")
def create_author_article(article: AuthorArticleCreate):
    try:
        return submit_article_for_author(article)
    except AuthorSubmissionStateConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except AuthorReceiptError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except RuntimeError:
        logger.exception("作者投稿保存失败")
        raise HTTPException(status_code=500, detail="投稿保存失败，请稍后重试。")
    except Exception:
        logger.exception("作者投稿发生未预期错误")
        raise HTTPException(status_code=500, detail="投稿失败，请稍后重试。")

@router.post("/article-statuses")
def api_list_author_articles(
    request: AuthorStatusBatchRequest,
):
    try:
        return {"articles": list_author_articles(request.references)}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception:
        logger.exception("读取作者稿件列表失败")
        raise HTTPException(status_code=500, detail="稿件列表加载失败，请稍后重试。")


@router.get("/articles")
def api_deprecated_author_lookup():
    raise HTTPException(
        status_code=410,
        detail="按笔名查询已停用，请使用投稿回执中的完整安全编号。",
    )


@router.post("/manuscript-text")
async def api_extract_manuscript_text(file: UploadFile = File(...)):
    try:
        return extract_docx_text(file.filename or "", await read_manuscript_upload(file))
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception:
        logger.exception("解析作者 DOCX 失败")
        raise HTTPException(status_code=500, detail="Word 文档解析失败，请稍后重试。")


@router.get("/articles/{reference}/status")
def api_get_article_status(reference: str):
    try:
        return get_article_status(reference)
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception:
        logger.exception("查询作者稿件状态失败: reference=%s", reference)
        raise HTTPException(status_code=500, detail="稿件状态查询失败，请稍后重试。")
