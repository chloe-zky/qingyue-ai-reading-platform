"""Per-day explicit discovery selections.

The reader picks a context once per business day; that choice decides what the
discovery page shows for the rest of the day and nothing else. It is kept
strictly apart from `reader_profiles.preference_weights`, which stays the
long-term learned model.

Two rules drive everything here:

* The business day is **Asia/Shanghai, from server time**. A browser clock is
  never trusted: a phone set to yesterday must not resurrect yesterday's row,
  and a UTC date would roll over at 08:00 Beijing time.
* `now` is injectable on every entry point so the day-boundary behaviour can be
  frozen in tests instead of being reconstructed from wall-clock luck.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from app.database import supabase
from app.schemas.recommendation import UserPreferences
from app.services.tag_service import get_valid_vocabularies
from app.utils.reader_auth import ReaderPrincipal
from app.utils.retry import retry_transport


BUSINESS_TIMEZONE = ZoneInfo("Asia/Shanghai")
PREFERENCE_FIELDS = (
    "setting_tags",
    "story_tone_tags",
    "relationship_core_tags",
)
DAILY_PREFERENCE_COLUMNS = (
    "user_id,preference_date,setting_tags,story_tone_tags,"
    "relationship_core_tags,completed_at,updated_at"
)
DAILY_PREFERENCE_TABLE = "reader_daily_preferences"


class InvalidDailyPreferenceError(ValueError):
    """The reader sent a tag outside the published vocabulary."""


class VocabularyUnavailableError(RuntimeError):
    """The controlled vocabulary could not be loaded, so nothing can be validated."""


def _utc_moment(now: datetime | None = None) -> datetime:
    """Normalize an injected instant to aware UTC; naive input is read as UTC."""
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def business_date(now: datetime | None = None) -> date:
    """Return the Asia/Shanghai calendar date for `now` (defaults to UTC now)."""
    return _utc_moment(now).astimezone(BUSINESS_TIMEZONE).date()


def _empty_selections() -> dict:
    return {field: [] for field in PREFERENCE_FIELDS}


def validated_selections(prefs: UserPreferences) -> dict:
    """Reject anything outside the published vocabulary before it reaches the DB.

    `UserPreferences` has already trimmed, de-duplicated and length-capped the
    three lists; what is left to prove is that every remaining term is a real
    controlled term. An empty selection is legitimate — it is the "跳过" path.
    """
    vocabulary = get_valid_vocabularies()
    selections = {}
    for field in PREFERENCE_FIELDS:
        chosen = list(getattr(prefs, field))
        allowed = vocabulary.get(field) or []
        if chosen and not allowed:
            # Cannot prove the terms are valid; failing open would let free text
            # into a controlled column.
            raise VocabularyUnavailableError("标签词表暂时不可用，请稍后重试。")
        unknown = [tag for tag in chosen if tag not in allowed]
        if unknown:
            raise InvalidDailyPreferenceError(
                f"选择包含未发布的标签：{'、'.join(unknown)}"
            )
        selections[field] = chosen
    return selections


def _normalized_row(row: dict, target: date) -> dict:
    return {
        "preference_date": str(row.get("preference_date") or target.isoformat()),
        "selections": {
            field: list(row.get(field) or []) for field in PREFERENCE_FIELDS
        },
        "completed_at": row.get("completed_at"),
        "updated_at": row.get("updated_at"),
    }


def get_today_selections(
    principal: ReaderPrincipal,
    now: datetime | None = None,
) -> dict | None:
    """Return today's stored selections, or None when the reader has not chosen.

    A missing row is *only* ever "not chosen today" — a failed query raises, so
    a transient outage can never be mistaken for a fresh day.
    """
    target = business_date(now)
    rows = (
        supabase.table(DAILY_PREFERENCE_TABLE)
        .select(DAILY_PREFERENCE_COLUMNS)
        .eq("user_id", principal.user_id)
        .eq("preference_date", target.isoformat())
        .limit(1)
        .execute()
        .data
        or []
    )
    return _normalized_row(rows[0], target) if rows else None


def save_today_selections(
    principal: ReaderPrincipal,
    prefs: UserPreferences,
    now: datetime | None = None,
) -> dict:
    """Upsert today's selections; re-choosing overwrites the same row.

    The conflict target is the primary key (user_id, preference_date), so a
    double submit from two tabs converges instead of duplicating. `completed_at`
    is deliberately absent from the payload: it keeps its original value on
    update and takes the column default on insert, so it stays "when this reader
    first completed today's flow".
    """
    target = business_date(now)
    selections = validated_selections(prefs)
    payload = {
        "user_id": principal.user_id,
        "preference_date": target.isoformat(),
        **selections,
        # 刻意取「即将写库的此刻」，而不是调用方注入的 now：注入的时刻用来定业务日
        # （必须与响应里的 server_date 同源），而词表校验可能先花掉几秒，用它当写入
        # 时间会让 updated_at 早于 DB 默认的 completed_at，读日志时像是先更新后创建。
        "updated_at": _utc_moment().isoformat(),
    }
    # PostgREST sends an upsert as POST, which the shared retrying transport
    # skips on purpose. This one is safe to retry by hand: it is keyed by the
    # primary key and re-applying it produces the identical row.
    response = retry_transport(
        lambda: supabase.table(DAILY_PREFERENCE_TABLE)
        .upsert(payload, on_conflict="user_id,preference_date")
        .execute()
    )
    rows = response.data or []
    return _normalized_row(rows[0] if rows else payload, target)


def selections_to_preferences(selections: dict | None) -> UserPreferences:
    """Rebuild the recommendation input from a stored row (or an empty day)."""
    source = selections or _empty_selections()
    return UserPreferences(**{
        field: list(source.get(field) or []) for field in PREFERENCE_FIELDS
    })
