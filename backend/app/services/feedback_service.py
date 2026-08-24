from app.database import supabase
from app.schemas.feedback import FeedbackCreate

def create_feedback(feedback: FeedbackCreate) -> dict:
    res = supabase.table("feedbacks").insert(feedback.model_dump()).execute()
    if not res.data:
        raise RuntimeError("反馈记录写入失败")
    return res.data[0]