import logging
import uuid
from app.database import supabase
from app.schemas.recommendation import UserPreferences

logger = logging.getLogger(__name__)


def _write_recommendation_log(payload: dict) -> None:
    """Analytics must not make an otherwise valid recommendation fail."""
    try:
        supabase.table("recommendation_logs").insert(payload).execute()
    except Exception:
        logger.exception("推荐结果已生成，但 recommendation_logs 写入失败")


def get_recommendations(prefs: UserPreferences) -> dict:
    strat_res = supabase.table("recommendation_strategies").select("*").eq("is_active", True).execute()
    if not strat_res.data:
        raise ValueError("找不到激活状态的推荐策略")
    strategy = strat_res.data[0]
    
    w_set = float(strategy['setting_weight'])
    w_tone = float(strategy['story_tone_weight'])
    w_rel = float(strategy['relationship_core_weight'])
    max_score = float(strategy['max_score'])

    # 防护：数据库为空时返回 [] 而不是 None
   
    # 修改前：
# books_data = supabase.table("books").select("id, title, author, intro, full_content").execute().data or []

# 修改后 (严格只推荐已审核通过的文章)：
    # 用 select("*") 拉全部已有列：
    # 这样即使 books 表里暂时还没有 cover_image_url 字段（用户尚未做 Supabase 迁移），
    # 查询也不会被 PostgREST 报错 400 拒绝，后续 .get("cover_image_url", "") 自然兜底为空串。
    books_data = supabase.table("books").select("*").eq("status", "active").execute().data or []
    tags_data = supabase.table("book_ai_tags").select("*").eq("tag_status", "confirmed").execute().data or []
    
    book_dict = {b['id']: b for b in books_data}
    results = []
    request_id = str(uuid.uuid4())

    # 默认推荐
    if not prefs.setting_tags and not prefs.story_tone_tags and not prefs.relationship_core_tags:
        recent_books = []
        tags_data.sort(key=lambda x: x.get('created_at') or "", reverse=True)
        
        for t in tags_data:
            b_id = t['book_id']
            if b_id in book_dict:
                recent_books.append({
                    "book_id": b_id,
                    "title": book_dict[b_id]['title'],
                    "author": book_dict[b_id]['author'],
                    "intro": book_dict[b_id]['intro'],
                    "full_content": book_dict.get(b_id, {}).get("full_content", ""),
                    # 编辑配图三件套——仅用于前台展示，不参与 AI 打标
                    "cover_image_url":    book_dict.get(b_id, {}).get("cover_image_url", "") or "",
                    "cover_photographer": book_dict.get(b_id, {}).get("cover_photographer", "") or "",
                    "cover_caption":      book_dict.get(b_id, {}).get("cover_caption", "") or "",
                    "score": 0,
                    "matched_tags": {"setting": [], "story_tone": [], "relationship": []},
                    "recommend_reason": t.get('recommend_reason', '')
                })
                if len(recent_books) >= 10:
                    break

        _write_recommendation_log({
            "request_id": request_id,
            "user_prefs": prefs.model_dump(),
            "strategy_version": strategy['version'],
            "result_book_ids": [r['book_id'] for r in recent_books],
            "result_scores": [r['score'] for r in recent_books]
        })
        return {"request_id": request_id, "results": recent_books}

    # 加权推荐
    for tag_record in tags_data:
        b_id = tag_record['book_id']
        if b_id not in book_dict: 
            continue
        
        selected_weight, score = 0, 0
        matched_setting, matched_tone, matched_relationship = [], [], []
        
        if prefs.setting_tags:
            selected_weight += w_set
            available = set(tag_record.get('setting_tags') or [])
            matched_setting = [tag for tag in prefs.setting_tags if tag in available]
            score += (len(matched_setting) / len(prefs.setting_tags)) * w_set
            
        if prefs.story_tone_tags:
            selected_weight += w_tone
            available = set(tag_record.get('story_tone_tags') or [])
            matched_tone = [tag for tag in prefs.story_tone_tags if tag in available]
            score += (len(matched_tone) / len(prefs.story_tone_tags)) * w_tone
            
        if prefs.relationship_core_tags:
            selected_weight += w_rel
            available = set(tag_record.get('relationship_core_tags') or [])
            matched_relationship = [
                tag for tag in prefs.relationship_core_tags if tag in available
            ]
            score += (len(matched_relationship) / len(prefs.relationship_core_tags)) * w_rel

        final_score = round((score / selected_weight) * max_score) if selected_weight > 0 else 0
        final_score = min(final_score, max_score)
        
        if final_score > 0:
            results.append({
                "book_id": b_id,
                "title": book_dict[b_id]['title'],
                "author": book_dict[b_id]['author'],
                "intro": book_dict[b_id]['intro'],
                "full_content": book_dict.get(b_id, {}).get("full_content", ""),
                # 编辑配图三件套——仅用于前台展示，不参与 AI 打标
                "cover_image_url":    book_dict.get(b_id, {}).get("cover_image_url", "") or "",
                "cover_photographer": book_dict.get(b_id, {}).get("cover_photographer", "") or "",
                "cover_caption":      book_dict.get(b_id, {}).get("cover_caption", "") or "",
                "score": final_score,
                "matched_tags": {
                    "setting": matched_setting,
                    "story_tone": matched_tone,
                    "relationship": matched_relationship
                },
                "recommend_reason": tag_record.get('recommend_reason', '')
            })

    results.sort(key=lambda x: (x['score'], x['book_id']), reverse=True)
    top_results = results[:6]

    _write_recommendation_log({
        "request_id": request_id,
        "user_prefs": prefs.model_dump(),
        "strategy_version": strategy['version'],
        "result_book_ids": [r['book_id'] for r in top_results],
        "result_scores": [r['score'] for r in top_results]
    })

    return {"request_id": request_id, "results": top_results}
