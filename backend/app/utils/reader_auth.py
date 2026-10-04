from collections import OrderedDict
from dataclasses import dataclass
import hashlib
import logging
from threading import Lock
from time import monotonic

from typing import Optional

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.database import supabase
from app.utils.retry import retry_transport


logger = logging.getLogger(__name__)


reader_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class ReaderPrincipal:
    user_id: str
    email: str
    display_name: str
    # 头像地址存在 Supabase Auth 的 user_metadata 里（见 reader_service
    # .set_reader_avatar：这样加头像不需要给 reader_profiles 加列）。
    # 校验令牌时顺带取回，不额外多一次查询。
    #
    # ⚠ 这是不可信值：user_metadata 允许用户拿自己的令牌直接改
    # （supabase.auth.updateUser），所以这里可能是任意字符串。对外输出前
    # 必须过 reader_service.safe_avatar_url —— 不要直接拿去渲染。
    avatar_url: str = ""


# 令牌校验缓存。
#
# 每个受保护请求原本都要向 Supabase Auth 走一次网络确认令牌，实测中位 314ms——
# 而读者进一次「我的」就会连打 /me、/favorites、/history 几条接口，等于反复为
# 同一个令牌付同样的钱。缓存住已验证的令牌能把这一段直接抹平。
#
# 安全上的三条约束：
#   1. 只缓存验证成功的结果，失败一律重新走网络（不给暴力尝试留下判据）。
#   2. 键是令牌的 SHA-256，不是令牌本身——内存快照或异常堆栈都拿不到可用凭证。
#   3. TTL 只有 60 秒，登出/撤销后最多 60 秒仍被接受；相对 Supabase 令牌本身
#      一小时的有效期，这个窗口足够小，也远小于前端会话的生命周期。
AUTH_CACHE_TTL_SECONDS = 60.0
AUTH_CACHE_MAX_ENTRIES = 512

_auth_cache: "OrderedDict[str, tuple[float, ReaderPrincipal]]" = OrderedDict()
_auth_cache_lock = Lock()


def _token_fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _cached_principal(fingerprint: str) -> Optional[ReaderPrincipal]:
    now = monotonic()
    with _auth_cache_lock:
        entry = _auth_cache.get(fingerprint)
        if not entry:
            return None
        expires_at, principal = entry
        if expires_at <= now:
            _auth_cache.pop(fingerprint, None)
            return None
        _auth_cache.move_to_end(fingerprint)
        return principal


def _remember_principal(fingerprint: str, principal: ReaderPrincipal) -> None:
    with _auth_cache_lock:
        _auth_cache[fingerprint] = (
            monotonic() + AUTH_CACHE_TTL_SECONDS, principal,
        )
        _auth_cache.move_to_end(fingerprint)
        while len(_auth_cache) > AUTH_CACHE_MAX_ENTRIES:
            _auth_cache.popitem(last=False)


def clear_reader_auth_cache() -> None:
    """Drop every cached validation (tests, and after a credential rollout)."""
    with _auth_cache_lock:
        _auth_cache.clear()


def forget_reader(user_id: str) -> int:
    """只作废这一个读者的缓存条目，返回清掉的条数。

    改头像/改资料后必须让缓存里的旧 principal 失效，但没必要把全体读者一起
    清掉——那会让所有人下一次请求都重新走一遍网络校验。缓存值里存着
    principal，所以能按 user_id 精确定位，不需要拿到对方的令牌。
    """
    with _auth_cache_lock:
        stale = [
            key for key, (_expires, principal) in _auth_cache.items()
            if principal.user_id == user_id
        ]
        for key in stale:
            _auth_cache.pop(key, None)
    return len(stale)


def _resolve_reader(
    credentials: Optional[HTTPAuthorizationCredentials],
) -> ReaderPrincipal:
    started = monotonic()
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="请先登录读者账号")

    fingerprint = _token_fingerprint(credentials.credentials)
    cached = _cached_principal(fingerprint)
    if cached is not None:
        return cached

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
    principal = ReaderPrincipal(
        user_id=str(user.id),
        email=getattr(user, "email", "") or "",
        display_name=display_name,
        avatar_url=str(metadata.get("avatar_url") or "").strip(),
    )
    _remember_principal(fingerprint, principal)
    logger.info("reader_auth_timing auth_ms=%.1f", (monotonic() - started) * 1000)
    return principal


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
