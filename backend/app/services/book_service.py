import secrets
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from app.database import supabase
from app.schemas.book import BookCreate
from app.services.catalog_visibility import is_hidden_from_catalog
from app.utils.media_urls import safe_cover_url


PUBLIC_BOOK_DETAIL_COLUMNS = (
    "id,title,author,intro,sample,full_content,cover_image_url,"
    "cover_photographer,cover_caption,created_at"
)

def get_all_books() -> list:
    # 公共书目只能展示已审核发布的内容，避免泄露待审作者稿件。
    res = (
        supabase.table("books")
        .select("id, title, author, intro, status")
        .eq("status", "active")
        .execute()
    )
    return [
        row for row in (res.data or [])
        if not is_hidden_from_catalog(row)
    ]


PUBLIC_BOOK_CARD_COLUMNS = (
    "id,title,author,intro,cover_image_url,cover_photographer,cover_caption"
)
MAX_SEARCH_QUERY_LENGTH = 40
DEFAULT_SEARCH_LIMIT = 20
MAX_SEARCH_LIMIT = 50


def normalize_search_query(raw: str) -> str:
    """Trim, collapse whitespace, and strip characters that carry pattern meaning.

    `%` and `_` are wildcards inside an ilike pattern; letting them through would
    turn a reader's literal query into a much broader match. `*` is PostgREST's
    own spelling of `%`. None of them are meaningful in an article title, so they
    are removed rather than escaped — no escape syntax to get subtly wrong.
    """
    cleaned = " ".join((raw or "").split())
    for pattern_char in ("%", "_", "*"):
        cleaned = cleaned.replace(pattern_char, "")
    return cleaned[:MAX_SEARCH_QUERY_LENGTH]


def _search_column(column: str, keyword: str, limit: int) -> list:
    return (
        supabase.table("books")
        .select(PUBLIC_BOOK_CARD_COLUMNS)
        .eq("status", "active")
        .ilike(column, f"%{keyword}%")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
        or []
    )


def search_public_books(raw_query: str, limit: int = DEFAULT_SEARCH_LIMIT) -> list:
    """Case-insensitive contains-match over published titles and author names.

    Title and author are queried separately and merged here rather than through
    one PostgREST `or=(...)` filter: that filter is a comma/parenthesis grammar
    embedded in the URL, so a title containing those characters would have to be
    quoted and escaped correctly every time. Two plain `ilike` calls have no
    grammar to break, at the cost of one extra roundtrip on a rare path.

    Full text is never searched, and only `status = active` rows are visible, so
    pending submissions cannot leak through this public endpoint.
    """
    keyword = normalize_search_query(raw_query)
    if not keyword:
        return []
    safe_limit = max(1, min(int(limit), MAX_SEARCH_LIMIT))

    # 两次查询并发发出。到 Supabase 的一次往返实测约 300ms，串行等于让每次搜索
    # 白等一倍；httpx 的连接池本身是线程安全的，并发只是把两次等待重叠起来。
    # 标题结果先并入，保证「标题命中优先」的顺序不受线程完成先后影响。
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {
            column: pool.submit(_search_column, column, keyword, safe_limit)
            for column in ("title", "author")
        }
        merged: dict[int, dict] = {}
        for column in ("title", "author"):
            for row in futures[column].result():
                merged.setdefault(int(row["id"]), row)

    # 标题命中排在作者命中之前，同类按新旧；book_id 兜底保证顺序稳定可测。
    lowered = keyword.lower()

    def rank(row: dict) -> tuple:
        title_hit = lowered in str(row.get("title") or "").lower()
        return (0 if title_hit else 1, -int(row["id"]))

    visible_results = (
        row for row in merged.values()
        if not is_hidden_from_catalog(row)
    )
    results = sorted(visible_results, key=rank)[:safe_limit]
    # 显式构造返回卡片，而不是把查询结果原样透出：即便将来有人改宽了上面的
    # select 列，正文与审核字段也不会从这个公开接口漏出去。
    return [_public_card(row) for row in results]


def _public_card(row: dict) -> dict:
    book_id = int(row["id"])
    return {
        "book_id": book_id,
        "id": book_id,
        "title": row.get("title") or "未命名作品",
        "author": row.get("author") or "匿名作者",
        "intro": row.get("intro") or "",
        "cover_image_url": safe_cover_url(row.get("cover_image_url") or ""),
        "cover_photographer": row.get("cover_photographer") or "",
        "cover_caption": row.get("cover_caption") or "",
    }


def get_public_book_detail(book_id: int) -> Optional[dict]:
    """Return one published article body; never expose drafts or review fields."""
    rows = (
        supabase.table("books")
        .select(PUBLIC_BOOK_DETAIL_COLUMNS)
        .eq("id", book_id)
        .eq("status", "active")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        return None
    book = dict(rows[0])
    book["cover_image_url"] = safe_cover_url(book.get("cover_image_url") or "")
    return book

def create_book(book: BookCreate, actor_user_id: str) -> int:
    # 作品和 draft 标签必须在同一数据库事务中创建，避免任一步失败留下半成品。
    response = supabase.rpc("create_internal_review_book", {
        "p_actor": actor_user_id,
        "p_title": book.title,
        "p_author": book.author,
        "p_intro": book.intro,
        "p_sample": book.sample,
        "p_full_content": book.full_content or "",
        # 内部录入没有作者回执。随机哈希只用于满足统一的数据库不变量，无法反推出
        # 一个可使用的作者凭证。
        "p_author_access_token_hash": secrets.token_hex(32),
    }).execute()
    data = response.data
    if isinstance(data, list):
        data = data[0] if data else None
    if isinstance(data, dict):
        data = data.get("book_id") or data.get("id")
    if not data:
        raise RuntimeError("无法原子创建待审作品")
    return int(data)
