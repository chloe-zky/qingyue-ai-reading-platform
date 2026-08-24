"""
upload_service.py

封装「图片上传到 Supabase Storage」逻辑。
只允许 image/jpeg / image/png / image/webp 三种类型。
单文件最大 5MB。
使用 uuid 重命名，避免覆盖。

注意：图片只用于前台展示，绝对不传给 LLM、不参与 AI 打标。
"""

import uuid
from typing import Tuple

from fastapi import UploadFile

from app.database import supabase

BUCKET_NAME = "covers"

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}

# Map mime → file extension (used to build the storage object name).
_EXT_BY_MIME = {
    "image/jpeg": "jpg",
    "image/png":  "png",
    "image/webp": "webp",
}

MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024  # 5MB


def _has_valid_signature(file_bytes: bytes, content_type: str) -> bool:
    """Verify the file header instead of trusting the browser-supplied MIME only."""
    if content_type == "image/jpeg":
        return len(file_bytes) >= 3 and file_bytes[:3] == b"\xff\xd8\xff"
    if content_type == "image/png":
        return file_bytes.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/webp":
        return (
            len(file_bytes) >= 12
            and file_bytes[:4] == b"RIFF"
            and file_bytes[8:12] == b"WEBP"
        )
    return False


async def _read_and_validate(file: UploadFile) -> Tuple[bytes, str, str]:
    """
    读取上传内容，做类型与大小校验。
    返回: (file_bytes, content_type, ext)
    """
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise ValueError(
            f"不支持的图片类型：{content_type or '未知'}。"
            "仅支持 JPEG / PNG / WebP。"
        )

    file_bytes = await file.read()
    size = len(file_bytes)
    if size == 0:
        raise ValueError("上传的图片为空文件。")
    if size > MAX_FILE_SIZE_BYTES:
        raise ValueError(
            f"图片体积过大（{size / (1024 * 1024):.2f}MB），"
            f"上限为 5MB。请压缩后再上传。"
        )

    if not _has_valid_signature(file_bytes, content_type):
        raise ValueError("图片内容与声明格式不一致，请重新导出后上传。")

    ext = _EXT_BY_MIME[content_type]
    return file_bytes, content_type, ext


def _build_object_name(ext: str) -> str:
    """使用 uuid 生成存储对象名，避免任何覆盖。"""
    return f"{uuid.uuid4().hex}.{ext}"


def _resolve_public_url(object_name: str) -> str:
    """
    取 Supabase Storage 公共 URL。
    不同版本的 supabase-py 对 get_public_url 返回值不一致：
    - 旧版本：直接返回字符串
    - 新版本：返回 dict / 带尾部 ?
    这里做兼容处理。
    """
    storage = supabase.storage.from_(BUCKET_NAME)
    raw = storage.get_public_url(object_name)

    if isinstance(raw, dict):
        # 例如 {"publicUrl": "...", "data": {...}}
        return (
            raw.get("publicUrl")
            or raw.get("public_url")
            or raw.get("data", {}).get("publicUrl", "")
        ).rstrip("?")

    if isinstance(raw, str):
        return raw.rstrip("?")

    # 极端兜底：自己拼。
    from app.config import SUPABASE_URL
    return f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/public/{BUCKET_NAME}/{object_name}"


def _remove_object_best_effort(object_name: str) -> None:
    """Avoid leaving an orphan if URL resolution fails after a successful upload."""
    try:
        supabase.storage.from_(BUCKET_NAME).remove([object_name])
    except Exception:
        pass


async def upload_cover_image(file: UploadFile) -> dict:
    """
    主入口：把单张图片上传到 covers bucket。
    成功返回 {"message", "cover_image_url"}。
    失败抛 ValueError（前端会得到 400）或 RuntimeError（500）。
    """
    file_bytes, content_type, ext = await _read_and_validate(file)
    object_name = _build_object_name(ext)

    try:
        storage = supabase.storage.from_(BUCKET_NAME)
        # supabase-py 接受 bytes；file_options 控制内容类型 + 不允许覆盖（uuid 已避免冲突）
        storage.upload(
            path=object_name,
            file=file_bytes,
            file_options={
                "content-type": content_type,
                "cache-control": "3600",
                "upsert": "false",
            },
        )
    except Exception as e:
        raise RuntimeError(f"图片上传到云存储失败：{str(e)}")

    try:
        public_url = _resolve_public_url(object_name)
    except Exception as e:
        _remove_object_best_effort(object_name)
        raise RuntimeError(f"图片已上传但获取公开链接失败：{str(e)}")

    if not public_url:
        _remove_object_best_effort(object_name)
        raise RuntimeError("图片已上传但未拿到公开链接，请稍后重试。")

    return {
        "message": "图片上传成功",
        "cover_image_url": public_url,
        "storage_path": object_name,
    }
