from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from app.database import supabase
from app.services.catalog_visibility import is_hidden_from_catalog
from app.utils.media_urls import safe_cover_url
from app.services.upload_service import BUCKET_NAME
from app.utils.reader_auth import ReaderPrincipal, forget_reader
from app.utils.retry import retry_transport


logger = logging.getLogger(__name__)


class ReaderBookNotFoundError(LookupError):
    pass


READER_BOOK_LIST_COLUMNS = (
    "id,title,author,intro,cover_image_url,cover_photographer,cover_caption"
)


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
    # POST, so the shared retrying transport leaves it alone — but this upsert
    # is keyed by user_id and writes the same row twice with the same result,
    # so a transient connection loss is safe to retry here.
    response = retry_transport(
        lambda: supabase.table("reader_profiles")
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
    """只取计数，不搬行。

    原来是把最多 5000 行拉回本地再 len()，纯粹为了一个数字付整份载荷。
    PostgREST 的 count='exact' + head=True 只回一个 Content-Range 头，
    行数据一行都不传。
    """
    response = (
        supabase.table(table)
        .select("book_id", count="exact", head=True)
        .eq("user_id", user_id)
        .execute()
    )
    count = getattr(response, "count", None)
    if count is not None:
        return int(count)
    # 兜底：万一某个部署的 PostgREST 没回 count，退回按行数算。
    return len(response.data or [])


def get_reader_profile(principal: ReaderPrincipal) -> dict:
    profile = _ensure_profile(principal)
    created_at = datetime.fromisoformat(str(profile["created_at"]).replace("Z", "+00:00"))
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    reader_days = max(1, (datetime.now(timezone.utc) - created_at).days + 1)

    # 两个计数彼此无关，并发发出。到 Supabase 的一次往返实测约 300ms，串行时
    # 这一个接口要等三轮；重叠之后省掉整整一轮。httpx 连接池本身线程安全。
    with ThreadPoolExecutor(max_workers=2) as pool:
        favorites = pool.submit(_count_rows, "reader_favorites", principal.user_id)
        history = pool.submit(_count_rows, "reading_history", principal.user_id)
        favorites_count = favorites.result()
        history_count = history.result()

    return {
        "user_id": principal.user_id,
        "email": principal.email,
        "display_name": profile["display_name"],
        # 头像存在 Auth 元数据里，随令牌校验一起取回，不额外多打一次库。
        "avatar_url": safe_avatar_url(principal.avatar_url),
        "reader_days": reader_days,
        "favorites_count": favorites_count,
        "history_count": history_count,
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


def _avatar_url_prefix() -> str:
    from app.config import SUPABASE_URL
    return (
        f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/public/"
        f"{BUCKET_NAME}/avatars/"
    )


def safe_avatar_url(raw: str) -> str:
    """只放行指向本项目存储里 avatars/ 目录的地址，其余一律当没有头像。

    user_metadata 是用户可以拿自己的令牌直接改的（supabase.auth.updateUser），
    所以这个字段本质上是用户输入。不校验就直接塞进 <img src>，等于让任意
    第三方地址在读者设备上被请求；将来头像一旦对其他人可见，就会变成一个
    可存储的内容注入点。校验放在读取侧而不是写入侧：写入路径以后可能变，
    读取这一处是所有出口的必经之地。
    """
    candidate = str(raw or "").strip()
    if not candidate:
        return ""
    base, _, _query = candidate.partition("?")   # 允许我们自己挂的 ?v= 缓存戳
    return candidate if base.startswith(_avatar_url_prefix()) else ""


def set_reader_avatar(principal: ReaderPrincipal, avatar_url: str) -> dict:
    """把头像地址存进 Supabase Auth 的 user_metadata。

    为什么不落 reader_profiles：那要加一列，也就要一次 DDL 迁移，而迁移需要
    另行授权执行。头像只是一个短字符串，放进本来就会被读出来的 user_metadata
    里，读写都走既有通道，零迁移、且跨设备生效。
    """
    # 先读回现有元数据再合并写。GoTrue 大概率是按键合并的，但这一点没有写进
    # 我们能控制的契约里；显式合并就不必赌它的版本行为，也不会把 OAuth 之类
    # 写进来的其它键抹掉。换头像是低频动作，多一次往返无所谓。
    existing = {}
    try:
        current = retry_transport(
            lambda: supabase.auth.admin.get_user_by_id(principal.user_id)
        )
        user = getattr(current, "user", None)
        existing = dict(getattr(user, "user_metadata", None) or {})
    except Exception:
        # 读不到就退回只写必要字段，至少不丢昵称。
        logger.warning("读取读者元数据失败，改为只写头像与昵称")
        if principal.display_name:
            existing = {"display_name": principal.display_name}

    existing["avatar_url"] = avatar_url
    retry_transport(lambda: supabase.auth.admin.update_user_by_id(
        principal.user_id, {"user_metadata": existing},
    ))
    # 缓存里那份 principal 还带着旧头像，不失效的话最长 60 秒内重新加载仍会
    # 看到换之前的图。只清这一个读者，不牵连其他人重新走网络校验。
    forget_reader(principal.user_id)
    return {"avatar_url": avatar_url}


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
        "cover_image_url": safe_cover_url(book.get("cover_image_url") or ""),
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
        .select(READER_BOOK_LIST_COLUMNS)
        .in_("id", book_ids)
        .eq("status", "active")
        .execute()
        .data
        or []
    )
    by_id = {
        book["id"]: book for book in books
        if not is_hidden_from_catalog(book)
    }
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
    # Setting the flag to a fixed value is idempotent, so this RPC opts into
    # retries even though it travels as a POST.
    response = retry_transport(lambda: supabase.rpc(
        "set_reader_favorite_atomic",
        {
            "p_user_id": principal.user_id,
            "p_book_id": book_id,
            "p_is_favorite": True,
        },
    ).execute())
    row = response.data[0] if isinstance(response.data, list) else response.data
    return row or {"book_id": book_id, "is_favorite": True}


def remove_favorite(principal: ReaderPrincipal, book_id: int) -> dict:
    _ensure_profile(principal)
    _active_book(book_id)
    response = retry_transport(lambda: supabase.rpc(
        "set_reader_favorite_atomic",
        {
            "p_user_id": principal.user_id,
            "p_book_id": book_id,
            "p_is_favorite": False,
        },
    ).execute())
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


def delete_reading_history(principal: ReaderPrincipal, book_id: int) -> dict:
    """Remove one reading-history row for this reader only.

    Scoped by both user_id and book_id, so one reader can never touch another's
    history. Deliberately idempotent: deleting a row that is already gone is a
    success, which keeps a double-tap or a retried request from turning into a
    user-visible error.

    The books table is not consulted — a reader must be able to clear the
    history of an article that has since been unpublished.
    """
    response = (
        supabase.table("reading_history")
        .delete()
        .eq("user_id", principal.user_id)
        .eq("book_id", book_id)
        .execute()
    )
    return {"book_id": book_id, "deleted": bool(response.data)}


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
