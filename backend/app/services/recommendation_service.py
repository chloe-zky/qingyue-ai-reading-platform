from __future__ import annotations

import logging
import uuid
from collections import Counter
from datetime import datetime, timezone

from app.database import supabase
from app.schemas.recommendation import UserPreferences
from app.services.personalization_service import (
    DIMENSION_COLUMNS,
    get_reader_personalization,
)
from app.utils.reader_auth import ReaderPrincipal
from app.utils.retry import retry_transport


logger = logging.getLogger(__name__)

PREFERENCE_KEYS = {
    "setting": "setting_tags",
    "story_tone": "story_tone_tags",
    "relationship_core": "relationship_core_tags",
}
BOOK_CANDIDATE_COLUMNS = (
    "id,title,author,intro,cover_image_url,cover_photographer,"
    "cover_caption,created_at"
)
BOOK_DETAIL_COLUMNS = "id,full_content"
TAG_CANDIDATE_COLUMNS = (
    "book_id,setting_tags,story_tone_tags,relationship_core_tags,"
    "recommend_reason,created_at"
)
CANDIDATE_PAGE_SIZE = 100
MAX_CANDIDATES = 500


def get_published_recommendation_strategy() -> dict:
    """Return canonical versioned settings; keep legacy rows as rollout fallback."""
    strategies = (
        supabase.table("editorial_strategies")
        .select("id")
        .eq("strategy_key", "emotional_tag_match")
        .eq("status", "active")
        .limit(1)
        .execute()
        .data
        or []
    )
    if strategies:
        versions = (
            supabase.table("editorial_strategy_versions")
            .select("version_no,settings")
            .eq("strategy_id", strategies[0]["id"])
            .eq("status", "published")
            .limit(1)
            .execute()
            .data
            or []
        )
        if versions:
            version = versions[0]
            settings = version.get("settings") or {}
            weights = settings.get("weights") or {}
            normalized = {
                "version": f"editorial-v{version['version_no']}",
                "setting_weight": float(weights.get("setting", 0)),
                "story_tone_weight": float(weights.get("story_tone", 0)),
                "relationship_core_weight": float(
                    weights.get("relationship_core", 0)
                ),
                "max_score": float(settings.get("max_score", 96)),
                "result_limit": int(settings.get("result_limit", 6)),
                "cold_start_limit": int(
                    (settings.get("cold_start") or {}).get("limit", 10)
                ),
            }
            total = sum(
                normalized[key]
                for key in (
                    "setting_weight",
                    "story_tone_weight",
                    "relationship_core_weight",
                )
            )
            if total != 100:
                raise ValueError("已发布推荐策略的权重之和不是 100")
            return normalized

    legacy = (
        supabase.table("recommendation_strategies")
        .select("*")
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not legacy:
        raise ValueError("找不到激活状态的推荐策略")
    return {**legacy[0], "result_limit": 6, "cold_start_limit": 10}


def _write_recommendation_log(payload: dict) -> None:
    """Analytics must not make an otherwise valid recommendation fail."""
    try:
        retry_transport(
            lambda: supabase.table("recommendation_logs").insert(payload).execute()
        )
    except Exception:
        logger.exception("推荐结果已生成，但 recommendation_logs 写入失败")


def _strategy_dimension_weights(strategy: dict) -> dict:
    return {
        "setting": float(strategy["setting_weight"]),
        "story_tone": float(strategy["story_tone_weight"]),
        "relationship_core": float(strategy["relationship_core_weight"]),
    }


def _explicit_match(
    prefs: UserPreferences,
    tag_record: dict,
    dimension_weights: dict,
) -> tuple[float, dict]:
    selected_weight = 0.0
    score = 0.0
    matched = {dimension: [] for dimension in DIMENSION_COLUMNS}
    for dimension, preference_key in PREFERENCE_KEYS.items():
        selected = getattr(prefs, preference_key)
        if not selected:
            continue
        selected_weight += dimension_weights[dimension]
        available = set(tag_record.get(DIMENSION_COLUMNS[dimension]) or [])
        matched[dimension] = [tag for tag in selected if tag in available]
        score += (
            len(matched[dimension]) / len(selected)
        ) * dimension_weights[dimension]
    return (score / selected_weight if selected_weight else 0.0), matched


def _behavior_affinity(
    tag_record: dict,
    preference_weights: dict,
    dimension_weights: dict,
) -> float:
    weighted_score = 0.0
    available_weight = 0.0
    for dimension in DIMENSION_COLUMNS:
        learned = preference_weights.get(dimension) or {}
        denominator = sum(abs(float(value)) for value in learned.values())
        if denominator <= 0:
            continue
        tags = tag_record.get(DIMENSION_COLUMNS[dimension]) or []
        affinity = sum(float(learned.get(tag, 0)) for tag in tags) / denominator
        affinity = max(-1.0, min(1.0, affinity))
        weighted_score += affinity * dimension_weights[dimension]
        available_weight += dimension_weights[dimension]
    return weighted_score / available_weight if available_weight else 0.0


def _fetch_active_book_candidates() -> list[dict]:
    rows: list[dict] = []
    for start in range(0, MAX_CANDIDATES, CANDIDATE_PAGE_SIZE):
        page = (
            supabase.table("books")
            .select(BOOK_CANDIDATE_COLUMNS)
            .eq("status", "active")
            .order("created_at", desc=True)
            .range(start, start + CANDIDATE_PAGE_SIZE - 1)
            .execute()
            .data
            or []
        )
        rows.extend(page)
        if len(page) < CANDIDATE_PAGE_SIZE:
            break
    return rows


def _fetch_confirmed_tags(book_ids: list[int]) -> list[dict]:
    rows: list[dict] = []
    for start in range(0, len(book_ids), CANDIDATE_PAGE_SIZE):
        batch = book_ids[start : start + CANDIDATE_PAGE_SIZE]
        if not batch:
            break
        rows.extend(
            supabase.table("book_ai_tags")
            .select(TAG_CANDIDATE_COLUMNS)
            .in_("book_id", batch)
            .eq("tag_status", "confirmed")
            .execute()
            .data
            or []
        )
    return rows


def _quality_scores(book_ids: list[int]) -> dict[int, float]:
    if not book_ids:
        return {}
    response = supabase.rpc(
        "get_book_quality_scores", {"p_book_ids": book_ids[:MAX_CANDIDATES]}
    ).execute()
    rows = response.data or []
    return {
        int(row["book_id"]): float(row.get("quality_score") or 0)
        for row in rows
    }


def _hydrate_full_content(results: list[dict]) -> list[dict]:
    ids = [int(item["book_id"]) for item in results]
    if not ids:
        return results
    rows = (
        supabase.table("books")
        .select(BOOK_DETAIL_COLUMNS)
        .in_("id", ids)
        .eq("status", "active")
        .execute()
        .data
        or []
    )
    content_by_id = {int(row["id"]): row.get("full_content") or "" for row in rows}
    for item in results:
        item["full_content"] = content_by_id.get(int(item["book_id"]), "")
    return results


def _freshness_scores(books: list[dict]) -> dict[int, float]:
    def timestamp(book: dict) -> datetime:
        try:
            parsed = datetime.fromisoformat(
                str(book.get("created_at") or "").replace("Z", "+00:00")
            )
        except ValueError:
            return datetime.min.replace(tzinfo=timezone.utc)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

    ordered = sorted(books, key=timestamp, reverse=True)
    denominator = max(1, len(ordered) - 1)
    return {
        int(book["id"]): 1 - rank / denominator
        for rank, book in enumerate(ordered)
    }


def _reader_penalties(principal: ReaderPrincipal | None) -> dict[int, float]:
    if not principal:
        return {}
    rows = (
        supabase.table("feedbacks")
        .select("book_id,reason")
        .eq("reader_user_id", principal.user_id)
        .limit(1000)
        .execute()
        .data
        or []
    )
    penalties = {}
    for row in rows:
        book_id = int(row["book_id"])
        if row.get("reason") == "不感兴趣":
            penalties[book_id] = -1.0
        elif row.get("reason") == "风格不符":
            penalties[book_id] = min(penalties.get(book_id, 0), -0.35)
    return penalties


def _book_result(
    book: dict,
    tag_record: dict,
    score: int,
    matched: dict,
) -> dict:
    return {
        "book_id": book["id"],
        "title": book.get("title") or "未命名作品",
        "author": book.get("author") or "匿名作者",
        "intro": book.get("intro") or "",
        "full_content": book.get("full_content") or "",
        "cover_image_url": book.get("cover_image_url") or "",
        "cover_photographer": book.get("cover_photographer") or "",
        "cover_caption": book.get("cover_caption") or "",
        "score": score,
        "matched_tags": {
            "setting": matched.get("setting", []),
            "story_tone": matched.get("story_tone", []),
            "relationship": matched.get("relationship_core", []),
        },
        "recommend_reason": tag_record.get("recommend_reason") or "",
    }


def _limit_author_repetition(results: list[dict], limit: int) -> list[dict]:
    selected = []
    deferred = []
    author_counts = Counter()
    for item in results:
        if author_counts[item["author"]] >= 2:
            deferred.append(item)
            continue
        selected.append(item)
        author_counts[item["author"]] += 1
        if len(selected) >= limit:
            return selected
    selected.extend(deferred[: max(0, limit - len(selected))])
    return selected[:limit]


def get_recommendations(
    prefs: UserPreferences,
    principal: ReaderPrincipal | None = None,
) -> dict:
    strategy = get_published_recommendation_strategy()
    max_score = float(strategy["max_score"])
    result_limit = max(1, min(int(strategy.get("result_limit", 6)), 50))
    cold_start_limit = max(1, min(int(strategy.get("cold_start_limit", 10)), 50))
    dimension_weights = _strategy_dimension_weights(strategy)

    books = _fetch_active_book_candidates()
    book_by_id = {int(book["id"]): book for book in books}
    tag_rows = _fetch_confirmed_tags(list(book_by_id))
    request_id = str(uuid.uuid4())

    state = (
        get_reader_personalization(principal)
        if principal
        else {"enabled": False, "weights": {}}
    )
    personalization_enabled = bool(principal and state["enabled"])
    learned_weights = state["weights"] if personalization_enabled else {}
    has_learned_preferences = any(
        float(score) > 0
        for values in learned_weights.values()
        for score in values.values()
    )
    has_explicit_preferences = any((
        prefs.setting_tags,
        prefs.story_tone_tags,
        prefs.relationship_core_tags,
    ))
    quality = _quality_scores(list(book_by_id)) if personalization_enabled else {}
    freshness = _freshness_scores(books)
    penalties = _reader_penalties(
        principal if personalization_enabled else None
    )

    candidates = []
    for tag_record in tag_rows:
        book_id = int(tag_record["book_id"])
        book = book_by_id.get(book_id)
        if not book:
            continue
        explicit_match, matched = _explicit_match(
            prefs, tag_record, dimension_weights
        )
        behavior_match = (
            _behavior_affinity(tag_record, learned_weights, dimension_weights)
            if has_learned_preferences
            else 0.0
        )

        if not has_explicit_preferences and not has_learned_preferences:
            continue
        if explicit_match <= 0 and behavior_match <= 0:
            continue
        if penalties.get(book_id) == -1.0:
            continue

        if personalization_enabled:
            normalized = (
                0.60 * explicit_match
                + 0.25 * behavior_match
                + 0.10 * quality.get(book_id, 0)
                + 0.05 * freshness.get(book_id, 0)
                + penalties.get(book_id, 0)
            )
        else:
            normalized = explicit_match
        final_score = round(max(0.0, min(1.0, normalized)) * max_score)
        if final_score > 0:
            candidates.append(
                _book_result(book, tag_record, final_score, matched)
            )

    if not has_explicit_preferences and not has_learned_preferences:
        tag_rows.sort(key=lambda row: row.get("created_at") or "", reverse=True)
        for tag_record in tag_rows:
            book_id = int(tag_record["book_id"])
            if book_id in book_by_id and penalties.get(book_id) != -1.0:
                candidates.append(
                    _book_result(book_by_id[book_id], tag_record, 0, {})
                )
            if len(candidates) >= cold_start_limit:
                break

    candidates.sort(
        key=lambda item: (item["score"], item["book_id"]),
        reverse=True,
    )
    top_results = _hydrate_full_content(
        _limit_author_repetition(candidates, result_limit)
    )
    _write_recommendation_log({
        "request_id": request_id,
        "reader_user_id": principal.user_id if principal else None,
        "user_prefs": prefs.model_dump(),
        "strategy_version": (
            f"{strategy['version']}-light-personalization-v1"
        ),
        "result_book_ids": [item["book_id"] for item in top_results],
        "result_scores": [item["score"] for item in top_results],
    })
    return {"request_id": request_id, "results": top_results}
