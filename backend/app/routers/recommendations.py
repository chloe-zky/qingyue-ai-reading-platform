import logging

from fastapi import APIRouter, HTTPException
from app.schemas.recommendation import UserPreferences
from app.services.recommendation_service import get_recommendations

router = APIRouter(prefix="/api/recommendations", tags=["Recommendations"])
logger = logging.getLogger(__name__)

@router.post("")
def api_get_recommendations(prefs: UserPreferences):
    try:
        return get_recommendations(prefs)
    except ValueError as e:
        logger.exception("推荐策略不可用")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception:
        logger.exception("生成推荐结果失败")
        raise HTTPException(status_code=500, detail="推荐生成失败，请稍后重试。")
