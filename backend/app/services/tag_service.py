from app.database import supabase
from app.schemas.tag import TagsSchema

def get_valid_vocabularies() -> dict:
    res = supabase.table("tag_vocabularies").select("tag_type, tag_name").eq("is_active", True).execute()
    vocab = {"setting_tags": [], "story_tone_tags": [], "relationship_core_tags": []}
    
    if not res.data:
        return vocab

    for item in res.data:
        t_type = item['tag_type']
        t_name = item['tag_name']
        if t_type == 'setting':
            vocab["setting_tags"].append(t_name)
        elif t_type == 'story_tone':
            vocab["story_tone_tags"].append(t_name)
        elif t_type == 'relationship_core':
            vocab["relationship_core_tags"].append(t_name)
    return vocab

def ensure_list(value):
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value:
        return [value]
    return []

def filter_tags(parsed_tags: dict, vocab: dict) -> dict:
    setting_tags = ensure_list(parsed_tags.get("setting_tags", []))
    story_tone_tags = ensure_list(parsed_tags.get("story_tone_tags", []))
    relationship_core_tags = ensure_list(parsed_tags.get("relationship_core_tags", []))
    
    return {
        "setting_tags": [t for t in setting_tags if t in vocab["setting_tags"]],
        "story_tone_tags": [t for t in story_tone_tags if t in vocab["story_tone_tags"]],
        "relationship_core_tags": [t for t in relationship_core_tags if t in vocab["relationship_core_tags"]],
        "aesthetic_tags": ensure_list(parsed_tags.get("aesthetic_tags", [])),
        "risk_tags": ensure_list(parsed_tags.get("risk_tags", [])),
        "recommend_reason": parsed_tags.get("recommend_reason", "")
    }

def confirm_book_tags(book_id: int, tags: TagsSchema):
    check = supabase.table("books").select("id").eq("id", book_id).execute()
    if not check.data:
        raise ValueError(f"找不到 ID 为 {book_id} 的书籍")

    vocab = get_valid_vocabularies()
    filtered_tags = filter_tags(tags.model_dump(), vocab)

    supabase.table("book_ai_tags").upsert({
        "book_id": book_id,
        **filtered_tags,
        "tag_source": "ai_reviewed",
        "tag_status": "confirmed"
    }, on_conflict="book_id").execute()