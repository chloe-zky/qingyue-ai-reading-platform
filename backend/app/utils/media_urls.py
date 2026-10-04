from __future__ import annotations

from urllib.parse import urlparse

from app.config import SUPABASE_URL


def safe_cover_url(raw: str) -> str:
    """Allow only HTTPS objects from this project's public covers bucket."""
    candidate = str(raw or "").strip()
    if not candidate:
        return ""
    try:
        expected = urlparse(SUPABASE_URL)
        parsed = urlparse(candidate)
    except ValueError:
        return ""
    prefix = "/storage/v1/object/public/covers/"
    if (
        parsed.scheme != "https"
        or parsed.hostname != expected.hostname
        or parsed.port not in {None, 443}
        or parsed.username
        or parsed.password
        or not parsed.path.startswith(prefix)
        or parsed.path.startswith(f"{prefix}avatars/")
        or parsed.fragment
    ):
        return ""
    return candidate


def require_safe_cover_url(raw: str) -> str:
    candidate = str(raw or "").strip()
    safe = safe_cover_url(candidate)
    if candidate and not safe:
        raise ValueError("封面必须来自本项目的 covers 公共存储桶")
    return safe
