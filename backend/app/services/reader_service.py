from __future__ import annotations

from datetime import datetime, timezone

from app.database import supabase
from app.utils.reader_auth import ReaderPrincipal


class ReaderBookNotFoundError(LookupError):
    pass


def _fallback_display_name(principal: ReaderPrincipal) -> str:
    metadata_name = principal.display_name.strip()
    if metadata_name:
        return metadata_name[:40]
    email_prefix = principal.email.partition("@")[0].strip()
    return (email_prefix or "轻阅读读者")[:40]


def _ensure_profile(principal: ReaderPrincipal) -> dict:
    rows = (
        supabase.table("reader_profiles")
        .select(
            "user_id,display_name,personalization_enabled,"
            "created_at,updated_at"
        )
        .eq("user_id", principal.user_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if rows:
        return rows[0]
    payload = {
        "user_id": principal.user_id,
        "display_name": _fallback_display_name(principal),
    }
    response = (
        supabase.table("reader_profiles")
        .upsert(payload, on_conflict="user_id")
        .execute()
    )
    created = response.data or []
    if created:
        return created[0]
    return (
        supabase.table("reader_profiles")
        .select(
            "user_id,display_name,personalization_enabled,"
            "created_at,updated_at"
        )
        .eq("user_id", principal.user_id)
        .limit(1)
        .execute()
        .data[0]
    )


def _count_rows(table: str, user_id: str) -> int:
    response = (
        supabase.table(table)
        .select("book_id")
        .eq("user_id", user_id)
        .limit(5000)
        .execute()
    )
    return len(response.data or [])


def get_reader_profile(principal: ReaderPrincipal) -> dict:
    profile = _ensure_profile(principal)
    created_at = datetime.fromisoformat(str(profile["created_at"]).replace("Z", "+00:00"))
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    reader_days = max(1, (datetime.now(timezone.utc) - created_at).days + 1)
    return {
        "user_id": principal.user_id,
        "email": principal.email,
        "display_name": profile["display_name"],
        "reader_days": reader_days,
        "favorites_count": _count_rows("reader_favorites", principal.user_id),
        "history_count": _count_rows("reading_history", principal.user_id),
        "personalization_enabled": bool(
            profile.get("personalization_enabled", True)
        ),
        "created_at": profile["created_at"],
    }


def update_reader_profile(
    principal: ReaderPrincipal,
    display_name: str | None = None,
    personalization_enabled: bool | None = None,
) -> dict:
    _ensure_profile(principal)
    now = datetime.now(timezone.utc).isoformat()
    changes = {"updated_at": now}
    if display_name is not None:
        changes["display_name"] = display_name.strip()
    if personalization_enabled is not None:
        changes["personalization_enabled"] = personalization_enabled
    (
        supabase.table("reader_profiles")
        .update(changes)
        .eq("user_id", principal.user_id)
        .execute()
    )
    return get_reader_profile(principal)


def _active_book(book_id: int) -> dict:
    rows = (
        supabase.table("books")
        .select("id")
        .eq("id", book_id)
        .eq("status", "active")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise ReaderBookNotFoundError("作品不存在或尚未发布")
    return rows[0]


def _book_item(book: dict, relation: dict) -> dict:
    return {
        "book_id": book["id"],
        "title": book.get("title") or "未命名作品",
        "author": book.get("author") or "匿名作者",
        "intro": book.get("intro") or "",
        "full_content": book.get("full_content") or "",
        "cover_image_url": book.get("cover_image_url") or "",
        "cover_photographer": book.get("cover_photographer") or "",
        "cover_caption": book.get("cover_caption") or "",
        "progress_percent": relation.get("progress_percent"),
        "saved_at": relation.get("created_at"),
        "last_read_at": relation.get("last_read_at"),
    }


def _related_books(relations: list[dict]) -> list[dict]:
    book_ids = [item["book_id"] for item in relations]
    if not book_ids:
        return []
    books = (
        supabase.table("books")
        .select("*")
        .in_("id", book_ids)
        .eq("status", "active")
        .execute()
        .data
        or []
    )
    by_id = {book["id"]: book for book in books}
    return [
        _book_item(by_id[item["book_id"]], item)
        for item in relations
        if item["book_id"] in by_id
    ]


def list_favorites(principal: ReaderPrincipal, limit: int = 100) -> list[dict]:
    _ensure_profile(principal)
    relations = (
        supabase.table("reader_favorites")
        .select("book_id,created_at")
        .eq("user_id", principal.user_id)
        .order("created_at", desc=True)
        .limit(max(1, min(limit, 500)))
        .execute()
        .data
        or []
    )
    return _related_books(relations)


def is_favorite(principal: ReaderPrincipal, book_id: int) -> bool:
    rows = (
        supabase.table("reader_favorites")
        .select("book_id")
        .eq("user_id", principal.user_id)
        .eq("book_id", book_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return bool(rows)


def add_favorite(principal: ReaderPrincipal, book_id: int) -> dict:
    _ensure_profile(principal)
    _active_book(book_id)
    response = supabase.rpc(
        "set_reader_favorite_atomic",
        {
            "p_user_id": principal.user_id,
            "p_book_id": book_id,
            "p_is_favorite": True,
        },
    ).execute()
    row = response.data[0] if isinstance(response.data, list) else response.data
    return row or {"book_id": book_id, "is_favorite": True}


def remove_favorite(principal: ReaderPrincipal, book_id: int) -> dict:
    _ensure_profile(principal)
    _active_book(book_id)
    response = supabase.rpc(
        "set_reader_favorite_atomic",
        {
            "p_user_id": principal.user_id,
            "p_book_id": book_id,
            "p_is_favorite": False,
        },
    ).execute()
    row = response.data[0] if isinstance(response.data, list) else response.data
    return row or {"book_id": book_id, "is_favorite": False}


def list_reading_history(principal: ReaderPrincipal, limit: int = 100) -> list[dict]:
    _ensure_profile(principal)
    relations = (
        supabase.table("reading_history")
        .select("book_id,progress_percent,last_read_at")
        .eq("user_id", principal.user_id)
        .order("last_read_at", desc=True)
        .limit(max(1, min(limit, 500)))
        .execute()
        .data
        or []
    )
    return _related_books(relations)


def save_reading_progress(
    principal: ReaderPrincipal,
    book_id: int,
    progress_percent: int,
    active_seconds_delta: int = 0,
    opened: bool = False,
    request_id: str | None = None,
) -> dict:
    _ensure_profile(principal)
    _active_book(book_id)
    response = supabase.rpc(
        "record_reader_progress_atomic",
        {
            "p_user_id": principal.user_id,
            "p_book_id": book_id,
            "p_progress_percent": progress_percent,
            "p_active_seconds_delta": active_seconds_delta,
            "p_opened": opened,
            "p_request_id": request_id,
        },
    ).execute()
    row = response.data[0] if isinstance(response.data, list) else response.data
    if not row:
        raise RuntimeError("阅读进度写入失败")
    return {
        "book_id": book_id,
        "progress_percent": row["progress_percent"],
        "active_seconds": row.get("active_seconds", 0),
        "open_count": row.get("open_count", 0),
        "completion_count": row.get("completion_count", 0),
        "last_read_at": row["last_read_at"],
    }
