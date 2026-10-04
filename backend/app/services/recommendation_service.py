from __future__ import annotations

import logging
import uuid
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock
from time import monotonic
from typing import Callable, TypeVar

from app.database import supabase
from app.schemas.recommendation import UserPreferences
from app.services.catalog_visibility import is_hidden_from_catalog
from app.utils.media_urls import safe_cover_url
from app.services.personalization_service import (
    DIMENSION_COLUMNS,
    get_reader_personalization,
    personalization_from_profile,
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
TAG_CANDIDATE_COLUMNS = (
    "book_id,setting_tags,story_tone_tags,relationship_core_tags,"
    "recommend_reason,created_at"
)
CANDIDATE_PAGE_SIZE = 100
MAX_CANDIDATES = 500
# Stable, testable match markers. They travel on every result item and are
# collapsed into one response-level marker the reader UI can phrase.
MATCH_EXACT = "exact"          # at least one selected tag is on the book
MATCH_CLOSEST = "closest"      # no selected tag matched; nearest available read
MATCH_COLD_START = "cold_start"  # reader made no explicit selection
MATCH_MIXED = "mixed"          # response-level only: exact + closest together
MATCH_EMPTY = "empty"          # response-level only: nothing to show
CLOSEST_NOTICE = "暂无完全匹配你选择的作品，以下是更接近的几篇。"
MIXED_NOTICE = "完全匹配的作品不多，其余是更接近你选择的几篇。"
STRATEGY_CACHE_SECONDS = 60.0
CATALOG_CACHE_SECONDS = 30.0
QUALITY_CACHE_SECONDS = 30.0
MAX_CACHE_ENTRIES = 64

T = TypeVar("T")
_CACHE_LOCK = Lock()
_CACHE: dict[tuple, tuple[float, object]] = {}


def clear_recommendation_cache() -> None:
    """Clear process-local recommendation snapshots (mainly for tests/rollouts)."""
    with _CACHE_LOCK:
        _CACHE.clear()


def _cached(key: tuple, ttl_seconds: float, loader: Callable[[], T]) -> T:
    now = monotonic()
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
        if cached and cached[0] > now:
            return deepcopy(cached[1])

    # Do network I/O outside the lock. A duplicate cold request is preferable
    # to blocking unrelated recommendation keys behind one Supabase roundtrip.
    value = loader()
    expires_at = monotonic() + ttl_seconds
    with _CACHE_LOCK:
        if len(_CACHE) >= MAX_CACHE_ENTRIES:
            expired = [cache_key for cache_key, item in _CACHE.items() if item[0] <= now]
            for cache_key in expired:
                _CACHE.pop(cache_key, None)
            if len(_CACHE) >= MAX_CACHE_ENTRIES:
                oldest = min(_CACHE, key=lambda cache_key: _CACHE[cache_key][0])
                _CACHE.pop(oldest, None)
        _CACHE[key] = (expires_at, deepcopy(value))
    return deepcopy(value)


def _load_published_recommendation_strategy() -> dict:
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


def get_published_recommendation_strategy() -> dict:
    return _cached(
        ("published_strategy",),
        STRATEGY_CACHE_SECONDS,
        _load_published_recommendation_strategy,
    )


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


def _load_active_book_candidates() -> list[dict]:
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


def _fetch_active_book_candidates() -> list[dict]:
    return _cached(
        ("active_books",),
        CATALOG_CACHE_SECONDS,
        _load_active_book_candidates,
    )


def _load_confirmed_tags(book_ids: list[int]) -> list[dict]:
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


def _fetch_confirmed_tags(book_ids: list[int]) -> list[dict]:
    normalized_ids = tuple(sorted({int(book_id) for book_id in book_ids}))
    return _cached(
        ("confirmed_tags", normalized_ids),
        CATALOG_CACHE_SECONDS,
        lambda: _load_confirmed_tags(list(normalized_ids)),
    )


def _load_quality_scores(book_ids: list[int]) -> dict[int, float]:
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


def _quality_scores(book_ids: list[int]) -> dict[int, float]:
    normalized_ids = tuple(sorted({int(book_id) for book_id in book_ids}))
    if not normalized_ids:
        return {}
    return _cached(
        ("quality_scores", normalized_ids),
        QUALITY_CACHE_SECONDS,
        lambda: _load_quality_scores(list(normalized_ids)),
    )


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
    return _penalties_from_rows(rows)


def _penalties_from_rows(rows: list[dict]) -> dict[int, float]:
    penalties = {}
    for row in rows:
        book_id = int(row["book_id"])
        if row.get("reason") == "不感兴趣":
            penalties[book_id] = -1.0
        elif row.get("reason") == "风格不符":
            penalties[book_id] = min(penalties.get(book_id, 0), -0.35)
    return penalties


def _load_recommendation_context(
    principal: ReaderPrincipal | None,
) -> dict:
    # A read-only (`stable`) RPC that happens to travel as POST, so it opts into
    # retries explicitly: a dropped idle connection must not blank the page.
    response = retry_transport(lambda: supabase.rpc("get_recommendation_context", {
        "p_reader_user_id": principal.user_id if principal else None,
        "p_limit": MAX_CANDIDATES,
    }).execute())
    data = response.data or {}
    return data[0] if isinstance(data, list) and data else data


def _recommendation_context(principal: ReaderPrincipal | None) -> dict:
    # Anonymous catalog traffic is safe to share briefly. Authenticated context
    # contains mutable per-reader feedback/preferences and is always read fresh.
    if principal:
        return _load_recommendation_context(principal)
    return _cached(
        ("recommendation_context", "anonymous"),
        CATALOG_CACHE_SECONDS,
        lambda: _load_recommendation_context(None),
    )


def _book_result(
    book: dict,
    tag_record: dict,
    score: int,
    matched: dict,
    match_type: str = MATCH_EXACT,
) -> dict:
    return {
        "book_id": book["id"],
        "title": book.get("title") or "未命名作品",
        "author": book.get("author") or "匿名作者",
        "intro": book.get("intro") or "",
        "cover_image_url": safe_cover_url(book.get("cover_image_url") or ""),
        "cover_photographer": book.get("cover_photographer") or "",
        "cover_caption": book.get("cover_caption") or "",
        "score": score,
        "matched_tags": {
            "setting": matched.get("setting", []),
            "story_tone": matched.get("story_tone", []),
            "relationship": matched.get("relationship_core", []),
        },
        "recommend_reason": tag_record.get("recommend_reason") or "",
        "match_type": match_type,
    }


def _response_match_state(
    results: list[dict],
    has_explicit_preferences: bool,
) -> tuple[str, str]:
    """Collapse per-item match types into one stable, testable response marker."""
    if not results:
        return (MATCH_EMPTY, "")
    if not has_explicit_preferences:
        return (MATCH_COLD_START, "")
    exact_count = sum(1 for item in results if item["match_type"] == MATCH_EXACT)
    if exact_count == len(results):
        return (MATCH_EXACT, "")
    if exact_count == 0:
        return (MATCH_CLOSEST, CLOSEST_NOTICE)
    return (MATCH_MIXED, MIXED_NOTICE)


def _closest_candidates(
    tag_rows: list[dict],
    book_by_id: dict,
    excluded_ids: set[int],
    penalties: dict,
    learned_weights: dict,
    dimension_weights: dict,
    quality: dict,
    freshness: dict,
    wanted: int,
) -> list[dict]:
    """Fill an under-filled exact-match list with the nearest available reads.

    Draws from the same active + confirmed-tag pool as the exact pass — nothing
    inactive or unconfirmed can enter here — and keeps the reader's "不感兴趣"
    exclusions. Ranking reuses the existing signals (learned affinity, quality,
    freshness) so the order is deterministic and explainable.
    """
    if wanted <= 0:
        return []
    scored = []
    for tag_record in tag_rows:
        book_id = int(tag_record["book_id"])
        book = book_by_id.get(book_id)
        if not book or book_id in excluded_ids:
            continue
        if penalties.get(book_id) == -1.0:
            continue
        affinity = (
            _behavior_affinity(tag_record, learned_weights, dimension_weights)
            if learned_weights
            else 0.0
        )
        scored.append((
            affinity,
            quality.get(book_id, 0.0),
            freshness.get(book_id, 0.0),
            book_id,
            tag_record,
            book,
        ))
    scored.sort(key=lambda item: item[:4], reverse=True)
    return [
        _book_result(book, tag_record, 0, {}, MATCH_CLOSEST)
        for _, _, _, _, tag_record, book in scored[:wanted]
    ]


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


def prepare_recommendations(
    prefs: UserPreferences,
    principal: ReaderPrincipal | None = None,
) -> tuple[dict, dict]:
    total_started = monotonic()
    context_started = monotonic()
    context = _recommendation_context(principal)
    context_ms = (monotonic() - context_started) * 1000
    strategy = context.get("strategy") or {}
    if not strategy:
        raise ValueError("找不到激活状态的推荐策略")
    if sum(float(strategy.get(key) or 0) for key in (
        "setting_weight", "story_tone_weight", "relationship_core_weight"
    )) != 100:
        raise ValueError("已发布推荐策略的权重之和不是 100")
    max_score = float(strategy["max_score"])
    result_limit = max(1, min(int(strategy.get("result_limit", 6)), 50))
    dimension_weights = _strategy_dimension_weights(strategy)

    rows = [
        row for row in (context.get("candidates") or [])
        if not is_hidden_from_catalog(row)
    ]
    books = [{
        key: row.get(key) for key in (
            "id", "title", "author", "intro", "cover_image_url",
            "cover_photographer", "cover_caption", "created_at",
        )
    } for row in rows]
    book_by_id = {int(book["id"]): book for book in books}
    tag_rows = [{
        "book_id": row.get("book_id"),
        "setting_tags": row.get("setting_tags") or [],
        "story_tone_tags": row.get("story_tone_tags") or [],
        "relationship_core_tags": row.get("relationship_core_tags") or [],
        "recommend_reason": row.get("recommend_reason") or "",
        "created_at": row.get("tag_created_at"),
    } for row in rows]
    request_id = str(uuid.uuid4())

    profile = context.get("reader_profile")
    state = ({"enabled": False, "weights": {}} if not principal else
             personalization_from_profile(profile) if profile else
             get_reader_personalization(principal))
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
    quality = ({int(row["book_id"]): float(row.get("quality_score") or 0)
                for row in rows} if personalization_enabled else {})
    freshness = _freshness_scores(books)
    penalties = (_penalties_from_rows(context.get("feedbacks") or [])
                 if personalization_enabled else {})

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
            # A book can also enter on learned affinity alone. That is not an
            # exact match, and saying so keeps the reader-facing notice honest.
            scored_match_type = (
                MATCH_EXACT
                if has_explicit_preferences
                and any(matched[dimension] for dimension in matched)
                else MATCH_CLOSEST if has_explicit_preferences
                else MATCH_COLD_START
            )
            candidates.append(
                _book_result(
                    book, tag_record, final_score, matched, scored_match_type
                )
            )

    if not has_explicit_preferences:
        # “跳过”代表不限定阅读目标，因此返回全部可推荐作品。已学习到的
        # 偏好仍可影响排序，但不能再把其余作品挡在固定数量上限之外。
        existing_ids = {int(item["book_id"]) for item in candidates}
        for tag_record in tag_rows:
            book_id = int(tag_record["book_id"])
            if (
                book_id not in existing_ids
                and book_id in book_by_id
                and penalties.get(book_id) != -1.0
            ):
                candidates.append(
                    _book_result(
                        book_by_id[book_id], tag_record, 0, {}, MATCH_COLD_START
                    )
                )

    candidates.sort(
        key=lambda item: (item["score"], item["book_id"]),
        reverse=True,
    )

    # An explicit selection nobody wrote a story for must not render a blank
    # page. Neither must a learned profile whose tags nothing currently carries
    # (the "skip every step" path lands there). Top up with the nearest
    # available reads, after the scored ones. The pure cold-start case is
    # already filled above.
    if has_explicit_preferences:
        # Return every exact match, even when there are more than the strategy's
        # historical six-item page target. Closest reads remain a bounded
        # fallback only when exact matches do not fill that target.
        exact_candidates = [
            item for item in candidates if item["match_type"] == MATCH_EXACT
        ]
        closest_candidates = [
            item for item in candidates if item["match_type"] != MATCH_EXACT
        ]
        missing = max(0, result_limit - len(exact_candidates))
        closest_candidates = closest_candidates[:missing]
        missing -= len(closest_candidates)
        if missing:
            excluded_ids = {
                int(item["book_id"])
                for item in exact_candidates + closest_candidates
            }
            closest_candidates.extend(_closest_candidates(
                tag_rows,
                book_by_id,
                excluded_ids,
                penalties,
                learned_weights if has_learned_preferences else {},
                dimension_weights,
                quality,
                freshness,
                missing,
            ))
        candidates = exact_candidates + closest_candidates

    # Author balancing may reorder a long list, but every selected candidate is
    # retained. The client already paginates this complete result three at a time.
    top_results = _limit_author_repetition(candidates, len(candidates))
    match_type, notice = _response_match_state(
        top_results, has_explicit_preferences
    )
    log_payload = {
        "request_id": request_id,
        "reader_user_id": principal.user_id if principal else None,
        "user_prefs": prefs.model_dump(),
        "strategy_version": (
            f"{strategy['version']}-light-personalization-v1"
        ),
        "result_book_ids": [item["book_id"] for item in top_results],
        "result_scores": [item["score"] for item in top_results],
    }
    logger.info(
        "recommendation_timing context_ms=%.1f ranking_ms=%.1f total_ms=%.1f "
        "authenticated=%s candidates=%d results=%d",
        context_ms,
        (monotonic() - context_started) * 1000 - context_ms,
        (monotonic() - total_started) * 1000,
        bool(principal),
        len(rows),
        len(top_results),
    )
    return {
        "request_id": request_id,
        "results": top_results,
        "match_type": match_type,
        "notice": notice,
    }, log_payload


def write_recommendation_log(payload: dict) -> None:
    _write_recommendation_log(payload)


def get_recommendations(
    prefs: UserPreferences,
    principal: ReaderPrincipal | None = None,
) -> dict:
    """Synchronous compatibility entry point used by services and tests."""
    result, log_payload = prepare_recommendations(prefs, principal)
    write_recommendation_log(log_payload)
    return result
