from app.database import supabase
from app.schemas.tag import TagsSchema
import time
from typing import Optional, Tuple


VOCABULARY_KEY_MAP = {
    "setting": "setting_tags",
    "story_tone": "story_tone_tags",
    "relationship_core": "relationship_core_tags",
    "aesthetic": "aesthetic_tags",
    "risk": "risk_tags",
}

_VOCABULARY_CACHE_TTL_SECONDS = 60
_vocabulary_cache: Optional[Tuple[float, dict]] = None


def _copy_vocabulary(vocabulary: dict) -> dict:
    return {
        key: list(value) if isinstance(value, list) else value
        for key, value in vocabulary.items()
    }


def get_valid_vocabularies(*, use_cache: bool = True) -> dict:
    global _vocabulary_cache
    now = time.monotonic()
    if use_cache and _vocabulary_cache and now - _vocabulary_cache[0] < _VOCABULARY_CACHE_TTL_SECONDS:
        return _copy_vocabulary(_vocabulary_cache[1])

    vocab = {field: [] for field in VOCABULARY_KEY_MAP.values()}

    published = (
        supabase.table("tag_vocabulary_versions")
        .select("id,version_no")
        .eq("status", "published")
        .limit(1)
        .execute()
        .data
        or []
    )
    if published:
        categories = (
            supabase.table("tag_categories")
            .select("id,category_key")
            .eq("vocabulary_version_id", published[0]["id"])
            .eq("status", "active")
            .execute()
            .data
            or []
        )
        category_map = {
            str(row["id"]): VOCABULARY_KEY_MAP.get(row.get("category_key"))
            for row in categories
        }
        category_ids = [row["id"] for row in categories]
        if category_ids:
            terms = (
                supabase.table("tag_terms")
                .select("category_id,name")
                .in_("category_id", category_ids)
                .eq("status", "active")
                .order("sort_order")
                .execute()
                .data
                or []
            )
            for item in terms:
                field = category_map.get(str(item["category_id"]))
                if field and item.get("name") not in vocab[field]:
                    vocab[field].append(item["name"])
        result = {"version_no": published[0].get("version_no"), **vocab}
        _vocabulary_cache = (now, result)
        return _copy_vocabulary(result)

    # Deployment fallback for databases that have not published the versioned
    # vocabulary yet. New installations should never reach this branch.
    res = (
        supabase.table("tag_vocabularies")
        .select("tag_type,tag_name")
        .eq("is_active", True)
        .execute()
    )

    for item in res.data or []:
        t_type = item['tag_type']
        t_name = item['tag_name']
        field = VOCABULARY_KEY_MAP.get(t_type)
        if field:
            vocab[field].append(t_name)
    result = {"version_no": None, **vocab}
    _vocabulary_cache = (now, result)
    return _copy_vocabulary(result)

def ensure_list(value):
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value:
        return [value]
    return []

def filter_tags(parsed_tags: dict, vocab: dict) -> dict:
    setting_tags = ensure_list(parsed_tags.get("setting_tags", []))
    story_tone_tags = ensure_list(parsed_tags.get("story_tone_tags", []))
    relationship_core_tags = ensure_list(parsed_tags.get("relationship_core_tags", []))
    
    return {
        "setting_tags": [t for t in setting_tags if t in vocab["setting_tags"]],
        "story_tone_tags": [t for t in story_tone_tags if t in vocab["story_tone_tags"]],
        "relationship_core_tags": [t for t in relationship_core_tags if t in vocab["relationship_core_tags"]],
        "aesthetic_tags": [
            tag
            for tag in ensure_list(parsed_tags.get("aesthetic_tags", []))
            if tag in vocab.get("aesthetic_tags", [])
        ],
        "risk_tags": [
            tag
            for tag in ensure_list(parsed_tags.get("risk_tags", []))
            if tag in vocab.get("risk_tags", [])
        ],
        "recommend_reason": parsed_tags.get("recommend_reason", "")
    }

def confirm_book_tags(book_id: int, tags: TagsSchema):
    check = supabase.table("books").select("id").eq("id", book_id).execute()
    if not check.data:
        raise ValueError(f"找不到 ID 为 {book_id} 的书籍")

    vocab = get_valid_vocabularies()
    filtered_tags = filter_tags(tags.model_dump(), vocab)

    supabase.table("book_ai_tags").upsert({
        "book_id": book_id,
        **filtered_tags,
        "tag_source": "ai_reviewed",
        "tag_status": "confirmed"
    }, on_conflict="book_id").execute()
