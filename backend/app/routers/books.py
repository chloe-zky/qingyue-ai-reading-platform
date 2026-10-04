import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from app.schemas.book import BookCreate, BookSearchItem
from app.services.book_service import (
    DEFAULT_SEARCH_LIMIT,
    MAX_SEARCH_LIMIT,
    MAX_SEARCH_QUERY_LENGTH,
    create_book,
    get_all_books,
    get_public_book_detail,
    search_public_books,
)
from app.utils.auth import StaffPrincipal, require_review_editor

router = APIRouter(prefix="/api/books", tags=["Books"])
logger = logging.getLogger(__name__)

@router.get("")
def api_get_books():
    return {"books": get_all_books()}


# 必须排在 /{book_id} 之前：否则 "search" 会被当成 book_id 匹配掉。
@router.get("/search", response_model=list[BookSearchItem])
def api_search_books(
    q: str = Query(default="", max_length=MAX_SEARCH_QUERY_LENGTH * 4),
    limit: int = Query(default=DEFAULT_SEARCH_LIMIT, ge=1, le=MAX_SEARCH_LIMIT),
):
    """Public title/author search over published articles only."""
    try:
        return search_public_books(q, limit)
    except Exception:
        logger.exception("作品搜索失败")
        raise HTTPException(status_code=500, detail="搜索失败，请稍后重试。")


@router.get("/{book_id}")
def api_get_book_detail(book_id: int):
    book = get_public_book_detail(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="作品不存在或尚未发布。")
    return book

@router.post("")
def api_add_book(
    book: BookCreate,
    principal: StaffPrincipal = Depends(require_review_editor),
):
    try:
        book_id = create_book(book, principal.user_id)
        return {"message": "书籍入库成功并初始化标签", "book_id": book_id}
    except RuntimeError:
        logger.exception("管理员新增书籍失败")
        raise HTTPException(status_code=500, detail="书籍入库失败，请稍后重试。")
