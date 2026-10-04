import logging

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from app.schemas.reader import (
    FavoriteStateResponse,
    ReaderAvatarResponse,
    ReaderBookItem,
    ReaderProfileResponse,
    ReaderProfileUpdate,
    ReadingHistoryDeleteResponse,
    ReadingProgressResponse,
    ReadingProgressUpdate,
)
from app.services.reader_service import (
    ReaderBookNotFoundError,
    add_favorite,
    delete_reading_history,
    get_reader_profile,
    is_favorite,
    list_favorites,
    list_reading_history,
    remove_favorite,
    save_reading_progress,
    set_reader_avatar,
    update_reader_profile,
)
from app.services.upload_service import upload_reader_avatar
from app.utils.reader_auth import ReaderPrincipal, get_current_reader


router = APIRouter(prefix="/api/reader", tags=["Reader"])
logger = logging.getLogger(__name__)


def _reader_operation(operation, message: str):
    try:
        return operation()
    except ReaderBookNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except httpx.TransportError:
        # The connection to Supabase dropped, most often an idle pooled one on a
        # mobile network. Retries already happened a layer down; what surfaces
        # here is genuinely retryable and is not a defect in this service, so it
        # must not masquerade as 500 — the client decides to try again.
        logger.warning("%s：与数据服务的连接中断", message)
        raise HTTPException(
            status_code=503, detail="网络连接不稳定，请稍后重试。"
        )
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


@router.post("/avatar", response_model=ReaderAvatarResponse)
async def reader_avatar_upload(
    file: UploadFile = File(...),
    principal: ReaderPrincipal = Depends(get_current_reader),
):
    """上传并启用读者头像。图片由前端压成 256px 方图后再上传。"""
    try:
        uploaded = await upload_reader_avatar(file, principal.user_id)
    except ValueError as exc:
        # 类型 / 尺寸 / 空文件这类客户端问题
        raise HTTPException(status_code=400, detail=str(exc))
    except httpx.TransportError:
        logger.warning("上传头像时与存储服务的连接中断")
        raise HTTPException(status_code=503, detail="网络连接不稳定，请稍后重试。")
    except Exception:
        logger.exception("头像上传失败")
        raise HTTPException(status_code=500, detail="头像上传失败，请稍后重试。")

    return _reader_operation(
        lambda: set_reader_avatar(principal, uploaded["avatar_url"]),
        "头像保存失败",
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


@router.delete("/history/{book_id}", response_model=ReadingHistoryDeleteResponse)
def reader_history_delete(
    book_id: int,
    principal: ReaderPrincipal = Depends(get_current_reader),
):
    """Remove one article from this reader's history. Idempotent."""
    return _reader_operation(
        lambda: delete_reading_history(principal, book_id), "删除阅读历史失败"
    )
