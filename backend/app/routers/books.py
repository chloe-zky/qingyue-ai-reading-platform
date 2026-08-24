import logging

from fastapi import APIRouter, Depends, HTTPException
from app.schemas.book import BookCreate
from app.services.book_service import get_all_books, create_book
from app.utils.auth import StaffPrincipal, require_review_editor

router = APIRouter(prefix="/api/books", tags=["Books"])
logger = logging.getLogger(__name__)

@router.get("")
def api_get_books():
    return {"books": get_all_books()}

@router.post("")
def api_add_book(
    book: BookCreate,
    principal: StaffPrincipal = Depends(require_review_editor),
):
    try:
        book_id = create_book(book)
        return {"message": "书籍入库成功并初始化标签", "book_id": book_id}
    except RuntimeError:
        logger.exception("管理员新增书籍失败")
        raise HTTPException(status_code=500, detail="书籍入库失败，请稍后重试。")
