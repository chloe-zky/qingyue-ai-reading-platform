from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from app.schemas.recommendation import UserPreferences
from app.services.daily_preference_service import (
    InvalidDailyPreferenceError,
    VocabularyUnavailableError,
    business_date,
    get_today_selections,
    save_today_selections,
    selections_to_preferences,
)
from app.services.recommendation_service import (
    prepare_recommendations,
    write_recommendation_log,
)
from app.utils.reader_auth import (
    ReaderPrincipal,
    get_current_reader,
    get_optional_reader,
)

router = APIRouter(prefix="/api/recommendations", tags=["Recommendations"])
logger = logging.getLogger(__name__)

# A dropped connection to Supabase is retryable and not a defect in this
# service; 503 says so, and the discovery page turns it into a retry screen
# instead of mistaking it for "this reader has not chosen today".
UNSTABLE_NETWORK_DETAIL = "网络连接不稳定，请稍后重试。"

@router.post("")
def api_get_recommendations(
    prefs: UserPreferences,
    background_tasks: BackgroundTasks,
    principal: Optional[ReaderPrincipal] = Depends(get_optional_reader),
):
    try:
        result, log_payload = prepare_recommendations(prefs, principal)
        background_tasks.add_task(write_recommendation_log, log_payload)
        return result
    except httpx.TransportError:
        raise HTTPException(status_code=503, detail=UNSTABLE_NETWORK_DETAIL)
    except ValueError as e:
        logger.exception("推荐策略不可用")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception:
        logger.exception("生成推荐结果失败")
        raise HTTPException(status_code=500, detail="推荐生成失败，请稍后重试。")


def _daily_payload(
    principal: ReaderPrincipal,
    stored: dict | None,
    background_tasks: BackgroundTasks,
    now: datetime,
) -> dict:
    """One roundtrip for the discovery page: today's state *and* its results.

    Returning recommendations together with the stored selections is what keeps
    the client from doing "ask for state, then ask for results". When the reader
    has not chosen yet there is nothing to recommend against, so only the date
    and `completed: false` come back and the client shows the three steps.
    """
    payload = {
        "server_date": business_date(now).isoformat(),
        "completed": stored is not None,
        "selections": (stored or {}).get("selections")
        or selections_to_preferences(None).model_dump(),
        "completed_at": (stored or {}).get("completed_at"),
        "updated_at": (stored or {}).get("updated_at"),
        "request_id": "",
        "results": [],
        "match_type": "",
        "notice": "",
    }
    if stored is None:
        return payload

    result, log_payload = prepare_recommendations(
        selections_to_preferences(stored["selections"]), principal
    )
    background_tasks.add_task(write_recommendation_log, log_payload)
    payload.update(result)
    return payload


@router.get("/daily")
def api_get_daily_recommendations(
    background_tasks: BackgroundTasks,
    principal: ReaderPrincipal = Depends(get_current_reader),
):
    """Today's discovery state for the signed-in reader (Asia/Shanghai day)."""
    now = datetime.now(timezone.utc)
    try:
        stored = get_today_selections(principal, now)
        return _daily_payload(principal, stored, background_tasks, now)
    except httpx.TransportError:
        logger.warning("读取今日发现状态时与数据服务的连接中断")
        raise HTTPException(status_code=503, detail=UNSTABLE_NETWORK_DETAIL)
    except ValueError as e:
        logger.exception("推荐策略不可用")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception:
        logger.exception("读取今日发现状态失败")
        raise HTTPException(status_code=500, detail="今日推荐读取失败，请稍后重试。")


@router.put("/daily")
def api_save_daily_recommendations(
    prefs: UserPreferences,
    background_tasks: BackgroundTasks,
    principal: ReaderPrincipal = Depends(get_current_reader),
):
    """Save (or overwrite) today's selections and return the matching results."""
    now = datetime.now(timezone.utc)
    try:
        stored = save_today_selections(principal, prefs, now)
        return _daily_payload(principal, stored, background_tasks, now)
    except InvalidDailyPreferenceError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except VocabularyUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except httpx.TransportError:
        logger.warning("保存今日发现偏好时与数据服务的连接中断")
        raise HTTPException(status_code=503, detail=UNSTABLE_NETWORK_DETAIL)
    except ValueError as e:
        logger.exception("推荐策略不可用")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception:
        logger.exception("保存今日发现偏好失败")
        raise HTTPException(status_code=500, detail="今日偏好保存失败，请稍后重试。")
