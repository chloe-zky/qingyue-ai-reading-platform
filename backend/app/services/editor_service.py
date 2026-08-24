from datetime import datetime, timezone
from typing import Optional

from app.database import supabase
from app.schemas.editor import ApproveArticleRequest


class SubmissionNotFoundError(ValueError):
    pass


class SubmissionStateConflictError(ValueError):
    pass


TAG_SNAPSHOT_COLUMNS = (
    "book_id,setting_tags,story_tone_tags,relationship_core_tags,"
    "aesthetic_tags,risk_tags,recommend_reason,tag_status,tag_source,"
    "raw_response,llm_provider,model_name,prompt_version"
)


def get_pending_submissions(limit: int = 100) -> list:
    # 1. 获取所有待审稿件
    safe_limit = max(1, min(limit, 200))
    books_res = (
        supabase.table("books")
        .select("*")
        .eq("status", "pending_review")
        .order("id", desc=False)
        .limit(safe_limit)
        .execute()
    )
    books = books_res.data or []

    # 2. 批量获取这些稿件的 AI 标签草稿
    book_ids = [b["id"] for b in books]
    tags_dict = {}
    if book_ids:
        tags_res = supabase.table("book_ai_tags").select("*").in_("book_id", book_ids).execute()
        for t in (tags_res.data or []):
            tags_dict[t["book_id"]] = t

    # 3. 组装给前端的完整数据结构
    results = []
    for b in books:
        b_tags = tags_dict.get(b["id"], {})
        results.append({
            "book_id": b["id"],
            "title": b["title"],
            "author": b["author"],
            "intro": b["intro"],
            "sample": b["sample"],
            "full_content": b.get("full_content", ""),
            # 编辑配图三件套（仅展示，不参与 AI 打标）。
            # 待审稿件初始一般是空，等编辑配图后审核通过才有值。
            "cover_image_url":    b.get("cover_image_url", "") or "",
            "cover_photographer": b.get("cover_photographer", "") or "",
            "cover_caption":      b.get("cover_caption", "") or "",
            "status": b["status"],
            "tags": {
                "setting_tags": b_tags.get("setting_tags", []),
                "story_tone_tags": b_tags.get("story_tone_tags", []),
                "relationship_core_tags": b_tags.get("relationship_core_tags", []),
                "aesthetic_tags": b_tags.get("aesthetic_tags", []),
                "risk_tags": b_tags.get("risk_tags", []),
                "recommend_reason": b_tags.get("recommend_reason", ""),
                "tag_status": b_tags.get("tag_status", "draft"),
                "tag_source": b_tags.get("tag_source", "ai")
            }
        })
    return results


def _restore_previous_tags(book_id: int, previous_tags: Optional[dict]) -> None:
    """Best-effort compensation if publishing the book fails after tag upsert."""
    if previous_tags:
        supabase.table("book_ai_tags").upsert(
            previous_tags, on_conflict="book_id"
        ).execute()
    else:
        supabase.table("book_ai_tags").delete().eq("book_id", book_id).execute()


def _record_editor_decision(
    book_id: int,
    *,
    next_status: str,
    feedback: str,
    action_label: str,
) -> dict:
    book_res = (
        supabase.table("books")
        .select("id,status")
        .eq("id", book_id)
        .execute()
    )
    if not book_res.data:
        raise SubmissionNotFoundError("找不到该稿件")

    current_status = book_res.data[0].get("status")
    if current_status != "pending_review":
        raise SubmissionStateConflictError(
            f"稿件当前状态为 {current_status or 'unknown'}，不能重复{action_label}。"
        )

    clean_feedback = (feedback or "").strip()
    if not clean_feedback:
        raise ValueError("编辑意见不能为空。")

    update_res = (
        supabase.table("books")
        .update(
            {
                "status": next_status,
                "editor_feedback": clean_feedback,
                "reviewed_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", book_id)
        .eq("status", "pending_review")
        .execute()
    )
    if not update_res.data:
        raise SubmissionStateConflictError("稿件状态已变化，请刷新列表后重试。")

    return {
        "message": f"稿件已{action_label}，编辑意见已同步给作者。",
        "book_id": book_id,
        "article_status": next_status,
        "editor_feedback": clean_feedback,
    }


def reject_submission(book_id: int, reason: str) -> dict:
    return _record_editor_decision(
        book_id,
        next_status="rejected",
        feedback=reason,
        action_label="拒稿",
    )


def request_submission_revision(book_id: int, note: str) -> dict:
    return _record_editor_decision(
        book_id,
        next_status="revision_requested",
        feedback=note,
        action_label="退回修改",
    )


def approve_submission(book_id: int, tags_data: ApproveArticleRequest) -> dict:
    # 1. 检查文章是否存在
    book_res = (
        supabase.table("books")
        .select("id,status")
        .eq("id", book_id)
        .execute()
    )
    if not book_res.data:
        raise SubmissionNotFoundError("找不到该稿件")

    current_status = book_res.data[0].get("status")
    if current_status != "pending_review":
        raise SubmissionStateConflictError(
            f"稿件当前状态为 {current_status or 'unknown'}，不能重复审核通过。"
        )

    previous_tags_res = (
        supabase.table("book_ai_tags")
        .select(TAG_SNAPSHOT_COLUMNS)
        .eq("book_id", book_id)
        .execute()
    )
    previous_tags = (previous_tags_res.data or [None])[0]

    # 2. 更新/插入审核确认后的标签
    # 标签 payload 不应包含配图字段——book_ai_tags 表没有这些列。
    tag_payload = {
        "setting_tags":           tags_data.setting_tags,
        "story_tone_tags":        tags_data.story_tone_tags,
        "relationship_core_tags": tags_data.relationship_core_tags,
        "aesthetic_tags":         tags_data.aesthetic_tags,
        "risk_tags":              tags_data.risk_tags,
        "recommend_reason":       tags_data.recommend_reason or "",
        "book_id":                book_id,
        "tag_status":             "confirmed",
        "tag_source":             "ai_reviewed",
    }
    supabase.table("book_ai_tags").upsert(
        tag_payload, on_conflict="book_id"
    ).execute()

    # 3. 将文章状态改为 active，并写入编辑配图三件套。
    #    兼容尚未做 ALTER TABLE 的旧库：先带配图字段更新，列缺失时回退仅更新 status。
    book_update = {
        "status":             "active",
        "cover_image_url":    (tags_data.cover_image_url or "").strip(),
        "cover_photographer": (tags_data.cover_photographer or "").strip(),
        "cover_caption":      (tags_data.cover_caption or "").strip(),
    }
    try:
        try:
            supabase.table("books").update(book_update).eq("id", book_id).execute()
        except Exception as e:
            msg = str(e).lower()
            missing_cover_column = (
                any(
                    key in msg
                    for key in (
                        "cover_image_url",
                        "cover_photographer",
                        "cover_caption",
                    )
                )
                and any(
                    key in msg
                    for key in ("column", "schema", "not find", "does not exist")
                )
            )
            if not missing_cover_column:
                raise
            supabase.table("books").update({"status": "active"}).eq(
                "id", book_id
            ).execute()
    except Exception as publish_error:
        try:
            _restore_previous_tags(book_id, previous_tags)
        except Exception as rollback_error:
            raise RuntimeError(
                "稿件发布失败，且标签状态自动回滚失败，请人工检查该稿件。"
            ) from rollback_error
        raise RuntimeError("稿件发布失败，标签状态已自动恢复。") from publish_error

    return {
        "message": "审核通过，稿件已进入推荐池。",
        "book_id": book_id,
        "article_status": "active",
        "tag_status": "confirmed"
    }
