"""Supabase client, hardened against transient connection loss.

Why this file has a transport in it:

Every Supabase call leaves this process over a pooled HTTP/2 connection. When
that connection is torn down while idle — the server closing it, or a phone
hotspot's NAT silently dropping the flow — the next request on it fails with
`httpx.ReadError` before a single byte of the response arrives. Nothing was
processed, nothing is ambiguous: the request simply never reached anyone.

That is exactly the failure readers were hitting as "读者数据处理失败" after a
refresh or re-login, when several API calls fire at once on connections that
went idle while the page was closed.

Re-dialling fixes it, so idempotent requests are retried here, once, for the
whole application. POST is deliberately excluded: PostgREST writes and RPC
calls are POSTs, and a read failure cannot tell us whether the server already
applied one. The few POSTs that are provably idempotent (upserts keyed by a
primary key, read-only RPCs) opt in explicitly at their call site through
`app.utils.retry.retry_transport`.
"""

import logging
import time

import httpx
from supabase import create_client, Client

from app.config import SUPABASE_URL, SUPABASE_SERVICE_KEY


logger = logging.getLogger(__name__)

# Methods where a transport failure means "never delivered", so a retry cannot
# duplicate an effect. PATCH/POST are absent on purpose.
IDEMPOTENT_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "PUT", "DELETE"})
TRANSPORT_ATTEMPTS = 3
TRANSPORT_BACKOFF_SECONDS = 0.1


class RetryingTransport(httpx.HTTPTransport):
    """Retry idempotent requests that fail before a response is returned.

    Only failures raised out of `handle_request` are retried — i.e. connect and
    response-header failures. Once a response object exists, streaming errors
    surface to the caller untouched, because part of the body may already have
    been consumed.
    """

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        attempts = (
            TRANSPORT_ATTEMPTS
            if request.method.upper() in IDEMPOTENT_METHODS
            else 1
        )
        for attempt in range(attempts):
            try:
                return super().handle_request(request)
            except httpx.TransportError as error:
                if attempt + 1 >= attempts:
                    raise
                logger.info(
                    "supabase_transport_retry method=%s attempt=%d error=%s",
                    request.method,
                    attempt + 1,
                    type(error).__name__,
                )
                time.sleep(TRANSPORT_BACKOFF_SECONDS * (attempt + 1))
        raise RuntimeError("unreachable")


def install_retrying_transport(client: Client) -> list[str]:
    """Swap in the retrying transport on each sub-client's httpx session.

    Supabase builds those sessions itself (with their own base URL and auth
    headers), so the transport is replaced afterwards rather than a client being
    injected — passing one shared `httpx_client` would strip exactly that
    per-service configuration.

    Returns the names of the sub-clients that were hardened, so a test can fail
    loudly if an httpx or supabase upgrade moves these internals instead of
    silently leaving the application without retries.
    """
    hardened = []
    # postgrest/storage expose the httpx client as `session`; the auth client
    # keeps it on `_http_client`. Both spellings are tried, and anything that
    # is not an httpx client is skipped rather than guessed at.
    for name in ("postgrest", "auth", "storage"):
        session = None
        for attribute in ("session", "_http_client"):
            try:
                candidate = getattr(getattr(client, name), attribute, None)
            except Exception:  # pragma: no cover - defensive against lazy init
                candidate = None
            if isinstance(candidate, httpx.Client):
                session = candidate
                break
        if session is None:
            continue
        # Mirrors what supabase configures for these sessions (verified against
        # supabase 2.31 / httpx 0.28: HTTP/1.1 + HTTP/2, default SSL context),
        # so only the retry behaviour changes.
        session._transport = RetryingTransport(
            verify=True,
            http2=True,
            # Connect-level failures are retried by httpx itself; response-level
            # ones by handle_request above.
            retries=1,
        )
        hardened.append(name)
    if not hardened:
        logger.warning(
            "未能安装 Supabase 重试传输层，瞬时连接中断将直接失败"
        )
    return hardened


def get_supabase_client() -> Client:
    # 前面 config 已经校验过了，这里直接连接
    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    install_retrying_transport(client)
    return client


supabase = get_supabase_client()
