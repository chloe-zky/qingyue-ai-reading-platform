from __future__ import annotations

from datetime import datetime, timezone
from math import exp, log
from typing import Iterable

from app.database import supabase
from app.utils.reader_auth import ReaderPrincipal


DIMENSION_COLUMNS = {
    "setting": "setting_tags",
    "story_tone": "story_tone_tags",
    "relationship_core": "relationship_core_tags",
}
HALF_LIFE_DAYS = 30.0
MAX_ABSOLUTE_WEIGHT = 20.0
MAX_TAGS_PER_DIMENSION = 50


def empty_preference_weights() -> dict:
    return {dimension: {} for dimension in DIMENSION_COLUMNS}


def _display_name(principal: ReaderPrincipal) -> str:
    name = principal.display_name.strip()
    if name:
        return name[:40]
    prefix = principal.email.partition("@")[0].strip()
    return (prefix or "轻阅读读者")[:40]


def _clean_weights(raw: object) -> dict:
    result = empty_preference_weights()
    if not isinstance(raw, dict):
        return result
    for dimension in DIMENSION_COLUMNS:
        values = raw.get(dimension)
        if not isinstance(values, dict):
            continue
        cleaned = []
        for tag, value in values.items():
            name = str(tag).strip()[:40]
            try:
                score = float(value)
            except (TypeError, ValueError):
                continue
            if name and abs(score) >= 0.05:
                cleaned.append((name, max(-MAX_ABSOLUTE_WEIGHT, min(score, MAX_ABSOLUTE_WEIGHT))))
        cleaned.sort(key=lambda item: abs(item[1]), reverse=True)
        result[dimension] = dict(cleaned[:MAX_TAGS_PER_DIMENSION])
    return result


def _parse_timestamp(value: object) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _decay_weights(weights: dict, updated_at: object, now: datetime) -> dict:
    age_days = max(0.0, (now - _parse_timestamp(updated_at)).total_seconds() / 86400)
    factor = exp(-log(2) * age_days / HALF_LIFE_DAYS)
    return _clean_weights({
        dimension: {tag: score * factor for tag, score in values.items()}
        for dimension, values in _clean_weights(weights).items()
    })


def _ensure_profile(principal: ReaderPrincipal) -> dict:
    rows = (
        supabase.table("reader_profiles")
        .select(
            "user_id,personalization_enabled,preference_weights,"
            "preference_updated_at"
        )
        .eq("user_id", principal.user_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if rows:
        return rows[0]
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "user_id": principal.user_id,
        "display_name": _display_name(principal),
        "personalization_enabled": True,
        "preference_weights": empty_preference_weights(),
        "preference_updated_at": now,
    }
    response = (
        supabase.table("reader_profiles")
        .upsert(payload, on_conflict="user_id")
        .execute()
    )
    return (response.data or [payload])[0]


def get_reader_personalization(principal: ReaderPrincipal) -> dict:
    profile = _ensure_profile(principal)
    now = datetime.now(timezone.utc)
    return {
        "enabled": bool(profile.get("personalization_enabled", True)),
        "weights": _decay_weights(
            profile.get("preference_weights"),
            profile.get("preference_updated_at"),
            now,
        ),
    }


def adjust_book_preferences(
    principal: ReaderPrincipal,
    book_id: int,
    delta: float,
    dimensions: Iterable[str] | None = None,
) -> dict:
    profile = _ensure_profile(principal)
    if not profile.get("personalization_enabled", True) or not delta:
        return _clean_weights(profile.get("preference_weights"))
    selected_dimensions = [
        dimension
        for dimension in (dimensions or DIMENSION_COLUMNS.keys())
        if dimension in DIMENSION_COLUMNS
    ]
    supabase.rpc(
        "_apply_book_preference_signal",
        {
            "p_user_id": principal.user_id,
            "p_book_id": book_id,
            "p_delta": delta,
            "p_dimensions": selected_dimensions,
        },
    ).execute()
    return get_reader_personalization(principal)["weights"]
