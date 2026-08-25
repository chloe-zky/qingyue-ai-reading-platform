from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from app.schemas.feedback import FeedbackCreate
from app.services.feedback_service import create_feedback
from app.utils.reader_auth import ReaderPrincipal, get_optional_reader

router = APIRouter(prefix="/api/feedback", tags=["Feedbacks"])

@router.post("")
def api_submit_feedback(
    req: FeedbackCreate,
    principal: Optional[ReaderPrincipal] = Depends(get_optional_reader),
):
    try:
        create_feedback(req, principal)
        return {"message": "感谢您的反馈，已记录"}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
