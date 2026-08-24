from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import FRONTEND_ORIGINS, FRONTEND_ORIGIN_REGEX
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
    tags,
    uploads,
)

app = FastAPI(title="AI 爱格风阅读推荐 API", description="模块化、高可用的后台架构")

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_origin_regex=FRONTEND_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(books.router)
app.include_router(tags.router)
app.include_router(recommendations.router)
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
@app.get("/")
def root():
    return {"message": "AI 爱格风阅读推荐后端已启动，请访问 /docs 查看接口文档"}
