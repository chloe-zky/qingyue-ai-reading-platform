import os
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN")

if not SUPABASE_URL:
    raise ValueError("缺少 SUPABASE_URL，请检查 .env")
if not SUPABASE_SERVICE_KEY:
    raise ValueError("缺少 SUPABASE_SERVICE_KEY，请检查 .env")
# ADMIN_TOKEN 只保留给迁移期本地排障使用。正式内部接口使用
# Supabase Auth access token + staff_profiles 角色，不再要求配置共享 Token。

APP_ENV = os.getenv("APP_ENV", "development")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")


def _parse_origins(raw_value: str) -> list[str]:
    """Parse a comma-separated origin list without keeping duplicates."""
    origins = []
    for value in (raw_value or "").split(","):
        origin = value.strip().rstrip("/")
        if origin and origin not in origins:
            origins.append(origin)
    return origins


FRONTEND_ORIGINS = _parse_origins(
    os.getenv("FRONTEND_ORIGINS", FRONTEND_ORIGIN)
)

# 手机热点地址经常变化。开发环境只额外放行常见私网地址的 Vite 端口，
# 生产环境仍严格使用 FRONTEND_ORIGINS 白名单。
FRONTEND_ORIGIN_REGEX = (
    r"^http://(?:localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|"
    r"192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])"
    r"(?:\.\d{1,3}){2}):5173$"
    if APP_ENV == "development"
    else None
)
