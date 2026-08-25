from __future__ import annotations

from app.database import supabase
from app.schemas.feedback import FeedbackCreate
from app.utils.reader_auth import ReaderPrincipal


def _existing_feedback(feedback: FeedbackCreate, reader_user_id: str | None):
    query = (
        supabase.table("feedbacks")
        .select("*")
        .eq("request_id", feedback.request_id)
        .eq("book_id", feedback.book_id)
    )
    if reader_user_id:
        query = query.eq("reader_user_id", reader_user_id)
    rows = query.limit(1).execute().data or []
    return rows[0] if rows else None


def create_feedback(
    feedback: FeedbackCreate,
    principal: ReaderPrincipal | None = None,
) -> dict:
    reader_user_id = principal.user_id if principal else None
    if principal:
        response = supabase.rpc(
            "record_reader_feedback_atomic",
            {
                "p_user_id": principal.user_id,
                "p_request_id": feedback.request_id,
                "p_book_id": feedback.book_id,
                "p_book_title": feedback.book_title,
                "p_reason": feedback.reason,
                "p_user_prefs": feedback.user_prefs,
                "p_feedback_note": feedback.feedback_note or "",
            },
        ).execute()
        row = response.data[0] if isinstance(response.data, list) else response.data
        if not row:
            raise RuntimeError("反馈记录写入失败")
        return row

    existing = _existing_feedback(feedback, reader_user_id)
    if existing:
        return existing

    payload = feedback.model_dump()
    payload["reader_user_id"] = reader_user_id
    res = supabase.table("feedbacks").insert(payload).execute()
    if not res.data:
        raise RuntimeError("反馈记录写入失败")
    return res.data[0]
