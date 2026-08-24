from supabase import create_client, Client
from app.config import SUPABASE_URL, SUPABASE_SERVICE_KEY

def get_supabase_client() -> Client:
    # 前面 config 已经校验过了，这里直接连接
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

supabase = get_supabase_client()