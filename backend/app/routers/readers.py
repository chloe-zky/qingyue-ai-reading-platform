import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from app.schemas.reader import (
    FavoriteStateResponse,
    ReaderBookItem,
    ReaderProfileResponse,
    ReaderProfileUpdate,
    ReadingProgressResponse,
    ReadingProgressUpdate,
)
from app.services.reader_service import (
    ReaderBookNotFoundError,
    add_favorite,
    get_reader_profile,
    is_favorite,
    list_favorites,
    list_reading_history,
    remove_favorite,
    save_reading_progress,
    update_reader_profile,
)
from app.utils.reader_auth import ReaderPrincipal, get_current_reader


router = APIRouter(prefix="/api/reader", tags=["Reader"])
logger = logging.getLogger(__name__)


def _reader_operation(operation, message: str):
    try:
        return operation()
    except ReaderBookNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception:
        logger.exception(message)
        raise HTTPException(status_code=500, detail="读者数据处理失败，请稍后重试。")


@router.get("/me", response_model=ReaderProfileResponse)
def reader_profile(
    principal: ReaderPrincipal = Depends(get_current_reader),
):
    return _reader_operation(
        lambda: get_reader_profile(principal), "读取读者资料失败"
    )


@router.patch("/me", response_model=ReaderProfileResponse)
def reader_profile_update(
    request: ReaderProfileUpdate,
    principal: ReaderPrincipal = Depends(get_current_reader),
):
    return _reader_operation(
        lambda: update_reader_profile(
            principal,
            request.display_name,
            request.personalization_enabled,
        ),
        "更新读者资料失败",
    )


@router.get("/favorites", response_model=list[ReaderBookItem])
def reader_favorites(
    limit: int = Query(default=100, ge=1, le=500),
    principal: ReaderPrincipal = Depends(get_current_reader),
):
    return _reader_operation(
        lambda: list_favorites(principal, limit), "读取读者收藏失败"
    )


@router.get("/favorites/{book_id}", response_model=FavoriteStateResponse)
def reader_favorite_state(
    book_id: int,
    principal: ReaderPrincipal = Depends(get_current_reader),
):
    return _reader_operation(
        lambda: FavoriteStateResponse(
            book_id=book_id, is_favorite=is_favorite(principal, book_id)
        ),
        "读取读者收藏状态失败",
    )


@router.post("/favorites/{book_id}", response_model=FavoriteStateResponse)
def reader_favorite_add(
    book_id: int,
    principal: ReaderPrincipal = Depends(get_current_reader),
):
    return _reader_operation(
        lambda: add_favorite(principal, book_id), "添加读者收藏失败"
    )


@router.delete("/favorites/{book_id}", response_model=FavoriteStateResponse)
def reader_favorite_remove(
    book_id: int,
    principal: ReaderPrincipal = Depends(get_current_reader),
):
    return _reader_operation(
        lambda: remove_favorite(principal, book_id), "移除读者收藏失败"
    )


@router.get("/history", response_model=list[ReaderBookItem])
def reader_history(
    limit: int = Query(default=100, ge=1, le=500),
    principal: ReaderPrincipal = Depends(get_current_reader),
):
    return _reader_operation(
        lambda: list_reading_history(principal, limit), "读取阅读历史失败"
    )


@router.put("/history/{book_id}", response_model=ReadingProgressResponse)
def reader_history_update(
    book_id: int,
    request: ReadingProgressUpdate,
    principal: ReaderPrincipal = Depends(get_current_reader),
):
    return _reader_operation(
        lambda: save_reading_progress(
            principal,
            book_id,
            request.progress_percent,
            request.active_seconds_delta,
            request.opened,
            request.request_id,
        ),
        "保存阅读进度失败",
    )
