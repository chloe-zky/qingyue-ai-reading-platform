import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from app.schemas.recommendation import UserPreferences
from app.services.recommendation_service import get_recommendations
from app.utils.reader_auth import ReaderPrincipal, get_optional_reader

router = APIRouter(prefix="/api/recommendations", tags=["Recommendations"])
logger = logging.getLogger(__name__)

@router.post("")
def api_get_recommendations(
    prefs: UserPreferences,
    principal: Optional[ReaderPrincipal] = Depends(get_optional_reader),
):
    try:
        return get_recommendations(prefs, principal)
    except ValueError as e:
        logger.exception("推荐策略不可用")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception:
        logger.exception("生成推荐结果失败")
        raise HTTPException(status_code=500, detail="推荐生成失败，请稍后重试。")
