from fastapi import APIRouter, HTTPException
from app.schemas.feedback import FeedbackCreate
from app.services.feedback_service import create_feedback

router = APIRouter(prefix="/api/feedback", tags=["Feedbacks"])

@router.post("")
def api_submit_feedback(req: FeedbackCreate):
    try:
        create_feedback(req)
        return {"message": "感谢您的反馈，已记录"}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))