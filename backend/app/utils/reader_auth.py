from dataclasses import dataclass

from typing import Optional

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.database import supabase
from app.utils.retry import retry_transport


reader_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class ReaderPrincipal:
    user_id: str
    email: str
    display_name: str


def _resolve_reader(
    credentials: Optional[HTTPAuthorizationCredentials],
) -> ReaderPrincipal:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="请先登录读者账号")
    try:
        response = retry_transport(
            lambda: supabase.auth.get_user(credentials.credentials)
        )
    except Exception:
        raise HTTPException(status_code=401, detail="读者登录已失效，请重新登录")

    user = getattr(response, "user", None)
    if user is None or not getattr(user, "id", None):
        raise HTTPException(status_code=401, detail="读者登录已失效，请重新登录")
    metadata = getattr(user, "user_metadata", None) or {}
    display_name = str(metadata.get("display_name") or "").strip()
    return ReaderPrincipal(
        user_id=str(user.id),
        email=getattr(user, "email", "") or "",
        display_name=display_name,
    )


def get_current_reader(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(reader_bearer),
) -> ReaderPrincipal:
    return _resolve_reader(credentials)


def get_optional_reader(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(reader_bearer),
) -> Optional[ReaderPrincipal]:
    """Keep public discovery available, but validate any supplied token."""
    if credentials is None:
        return None
    return _resolve_reader(credentials)
