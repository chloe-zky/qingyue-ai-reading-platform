from __future__ import annotations

import json
import uuid
from collections.abc import Awaitable, Callable

from app.config import MAX_JSON_BODY_BYTES


MANUSCRIPT_BODY_BYTES = 22 * 1024 * 1024
IMAGE_BODY_BYTES = 6 * 1024 * 1024
BODY_METHODS = {"POST", "PUT", "PATCH"}
PATH_LIMITS = {
    "/api/author/manuscript-text": MANUSCRIPT_BODY_BYTES,
    "/api/uploads/cover": IMAGE_BODY_BYTES,
    "/api/reader/avatar": IMAGE_BODY_BYTES,
}


class RequestBodyTooLarge(Exception):
    pass


class RequestBodyLimitMiddleware:
    """Reject oversized fixed-length and chunked request bodies before parsing."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("method") not in BODY_METHODS:
            await self.app(scope, receive, send)
            return

        limit = PATH_LIMITS.get(scope.get("path", ""), MAX_JSON_BODY_BYTES)
        content_lengths = [
            value
            for name, value in scope.get("headers", [])
            if name.lower() == b"content-length"
        ]
        if len(content_lengths) > 1:
            await self._reject(send, 400, "Content-Length 请求头无效")
            return
        if content_lengths:
            try:
                declared = int(content_lengths[0])
            except (TypeError, ValueError):
                await self._reject(send, 400, "Content-Length 请求头无效")
                return
            if declared < 0:
                await self._reject(send, 400, "Content-Length 请求头无效")
                return
            if declared > limit:
                await self._reject(send, 413, "请求内容过大")
                return

        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message.get("type") == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise RequestBodyTooLarge
            return message

        response_started = False

        async def tracking_send(message):
            nonlocal response_started
            if message.get("type") == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except RequestBodyTooLarge:
            if response_started:
                raise
            await self._reject(send, 413, "请求内容过大")

    @staticmethod
    async def _reject(send: Callable[[dict], Awaitable[None]], status: int, detail: str):
        request_id = uuid.uuid4().hex
        body = json.dumps(
            {"detail": detail, "request_id": request_id},
            ensure_ascii=False,
        ).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode("ascii")),
                (b"x-request-id", request_id.encode("ascii")),
            ],
        })
        await send({"type": "http.response.body", "body": body})
