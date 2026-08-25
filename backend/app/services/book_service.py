import secrets

from app.database import supabase
from app.schemas.book import BookCreate

def get_all_books() -> list:
    # 公共书目只能展示已审核发布的内容，避免泄露待审作者稿件。
    res = (
        supabase.table("books")
        .select("id, title, author, intro, status")
        .eq("status", "active")
        .execute()
    )
    return res.data if res.data else []

def create_book(book: BookCreate) -> int:
    payload = {
        **book.model_dump(),
        # Internal catalog entries have no author-facing receipt. A random valid
        # hash satisfies the same database invariant without creating a usable
        # or recoverable author credential.
        "author_access_token_hash": secrets.token_hex(32),
    }
    res = supabase.table("books").insert(payload).execute()
    if not res.data:
        raise RuntimeError("无法将书籍插入数据库")
    
    book_id = res.data[0]['id']
    tag_res = supabase.table("book_ai_tags").insert({
        "book_id": book_id,
        "tag_source": "manual",
        "tag_status": "draft"
    }).execute()
    
    if not tag_res.data:
        raise RuntimeError("无法初始化书籍标签记录")
        
    return book_id
