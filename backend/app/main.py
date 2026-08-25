import json
import logging
import re
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.config import APP_ENV, FRONTEND_ORIGINS, FRONTEND_ORIGIN_REGEX
from app.database import supabase
from app.utils.rate_limit import PUBLIC_RATE_RULES, public_rate_limiter
from app.routers import (
    admin,
    authors,
    books,
    editor,
    editorial,
    feedbacks,
    internal,
    platform,
    recommendations,
    readers,
    tags,
    uploads,
)

app = FastAPI(
    title="轻阅读 AI 内容与个性化阅读平台 API",
    description="读者、作者与三角色编辑工作台的统一服务边界",
)
logger = logging.getLogger("uvicorn.error")
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{8,64}$")

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_origin_regex=FRONTEND_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    incoming = (request.headers.get("x-request-id") or "").strip()
    request_id = incoming if REQUEST_ID_RE.fullmatch(incoming) else uuid.uuid4().hex
    request.state.request_id = request_id
    started = time.perf_counter()
    rule = PUBLIC_RATE_RULES.get((request.method, request.url.path))
    if rule:
        identity = request.client.host if request.client else "unknown"
        allowed, retry_after = public_rate_limiter.check(rule, identity)
        if not allowed:
            logger.warning(json.dumps({
                "event": "request.rate_limited",
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "retry_after": retry_after,
            }, ensure_ascii=False))
            response = JSONResponse(
                status_code=429,
                content={"detail": "请求过于频繁，请稍后重试。", "request_id": request_id},
                headers={"Retry-After": str(retry_after)},
            )
            response.headers["X-Request-ID"] = request_id
            return response
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - started) * 1000)
        logger.exception(json.dumps({
            "event": "request.failed",
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "duration_ms": duration_ms,
        }, ensure_ascii=False))
        response = JSONResponse(
            status_code=500,
            content={"detail": "服务暂时异常，请稍后重试。", "request_id": request_id},
        )
    response.headers["X-Request-ID"] = request_id
    logger.info(json.dumps({
        "event": "request.completed",
        "request_id": request_id,
        "method": request.method,
        "path": request.url.path,
        "status": response.status_code,
        "duration_ms": round((time.perf_counter() - started) * 1000),
    }, ensure_ascii=False))
    return response

app.include_router(books.router)
app.include_router(tags.router)
app.include_router(recommendations.router)
app.include_router(readers.router)
app.include_router(feedbacks.router)
app.include_router(admin.router)
app.include_router(authors.router)
app.include_router(editor.router)
app.include_router(editorial.router)
app.include_router(uploads.router)
app.include_router(internal.router)
app.include_router(platform.router)

@app.get("/api/health", tags=["Health"])
def health_check():
    return {"status": "ok"}


@app.get("/api/health/live", tags=["Health"])
def liveness_check():
    return {"status": "alive"}


@app.get("/api/health/ready", tags=["Health"])
def readiness_check():
    try:
        supabase.table("books").select("id").limit(1).execute()
    except Exception:
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "database": "unavailable"},
        )
    return {"status": "ready", "database": "available", "environment": APP_ENV}
@app.get("/")
def root():
    return {"message": "轻阅读平台后端已启动，请访问 /docs 查看接口文档"}
