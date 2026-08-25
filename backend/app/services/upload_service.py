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
MAX_IMAGE_PIXELS = 24_000_000
MAX_IMAGE_DIMENSION = 10_000
READ_CHUNK_BYTES = 64 * 1024


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


def _jpeg_dimensions(data: bytes) -> tuple[int, int]:
    offset = 2
    sof_markers = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    while offset + 9 <= len(data):
        if data[offset] != 0xFF:
            offset += 1
            continue
        marker = data[offset + 1]
        offset += 2
        if marker in {0xD8, 0xD9} or 0xD0 <= marker <= 0xD7:
            continue
        if offset + 2 > len(data):
            break
        segment_size = int.from_bytes(data[offset:offset + 2], "big")
        if segment_size < 2 or offset + segment_size > len(data):
            break
        if marker in sof_markers and segment_size >= 7:
            return (
                int.from_bytes(data[offset + 5:offset + 7], "big"),
                int.from_bytes(data[offset + 3:offset + 5], "big"),
            )
        offset += segment_size
    raise ValueError("无法读取 JPEG 像素尺寸，请重新导出后上传。")


def _image_dimensions(data: bytes, content_type: str) -> tuple[int, int]:
    if content_type == "image/png":
        if len(data) < 24 or data[12:16] != b"IHDR":
            raise ValueError("PNG 文件结构不完整，请重新导出后上传。")
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    if content_type == "image/jpeg":
        return _jpeg_dimensions(data)
    if data[12:16] == b"VP8X" and len(data) >= 30:
        return 1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little")
    if data[12:16] == b"VP8 " and len(data) >= 30 and data[23:26] == b"\x9d\x01\x2a":
        return int.from_bytes(data[26:28], "little") & 0x3FFF, int.from_bytes(data[28:30], "little") & 0x3FFF
    if data[12:16] == b"VP8L" and len(data) >= 25 and data[20] == 0x2F:
        b1, b2, b3, b4 = data[21:25]
        return 1 + b1 + ((b2 & 0x3F) << 8), 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0F) << 10)
    raise ValueError("无法读取 WebP 像素尺寸，请重新导出后上传。")


async def _read_bounded(file: UploadFile) -> bytes:
    chunks = []
    size = 0
    while True:
        chunk = await file.read(READ_CHUNK_BYTES)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_FILE_SIZE_BYTES:
            raise ValueError("图片体积过大，上限为 5MB。请压缩后再上传。")
        chunks.append(chunk)
    return b"".join(chunks)


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

    file_bytes = await _read_bounded(file)
    size = len(file_bytes)
    if size == 0:
        raise ValueError("上传的图片为空文件。")
    if not _has_valid_signature(file_bytes, content_type):
        raise ValueError("图片内容与声明格式不一致，请重新导出后上传。")

    width, height = _image_dimensions(file_bytes, content_type)
    if width <= 0 or height <= 0:
        raise ValueError("图片像素尺寸无效，请重新导出后上传。")
    if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
        raise ValueError("图片边长过大，上限为 10000 像素。")
    if width * height > MAX_IMAGE_PIXELS:
        raise ValueError("图片总像素过大，上限为 2400 万像素。")

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
