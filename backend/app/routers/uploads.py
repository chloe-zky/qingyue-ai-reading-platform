"""
uploads.py — 文件上传相关接口。

POST /api/uploads/cover —— 上传一张配图到 Supabase Storage `covers` bucket。

⚠️ 鉴权：本接口仅供审稿编辑使用，必须携带 Supabase Bearer access token。
   作者端不再调用此接口（产品流程已变更：配图由编辑部统一处理）。
"""

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.services.upload_service import upload_cover_image
from app.utils.auth import StaffPrincipal, require_review_editor

router = APIRouter(prefix="/api/uploads", tags=["Uploads"])
logger = logging.getLogger(__name__)


@router.post("/cover")
async def upload_cover(
    file: UploadFile = File(...),
    principal: StaffPrincipal = Depends(require_review_editor),
):
    try:
        return await upload_cover_image(file)
    except ValueError as ve:
        # 类型 / 大小 / 空文件 这类客户端错误
        raise HTTPException(status_code=400, detail=str(ve))
    except RuntimeError:
        # 上传到存储侧失败
        logger.exception("封面上传到存储失败")
        raise HTTPException(status_code=500, detail="图片上传失败，请稍后重试。")
    except Exception:
        logger.exception("封面上传发生未预期错误")
        raise HTTPException(status_code=500, detail="图片上传异常，请稍后重试。")
