from pydantic import BaseModel, Field
from typing import Optional


class AuthorArticleCreate(BaseModel):
    """
    作者投稿表单。
    注意：作者端不再上传配图——配图、摄影师署名、图片说明由编辑部在审稿阶段统一处理。
    cover_image_url 字段保留只是为了向后兼容旧前端请求体，
    在 author_service 中会被显式忽略，绝不会写入 books 表。
    """
    title: str = Field(min_length=1, max_length=120)
    author: str = Field(min_length=1, max_length=80)
    intro: str = Field(min_length=1, max_length=1000)
    sample: str = Field(min_length=1, max_length=5000)
    full_content: Optional[str] = Field(default="", max_length=500_000)
    cover_image_url: Optional[str] = ""  # 接受但忽略，仅为向后兼容
    revision_reference: Optional[str] = Field(default=None, min_length=20, max_length=160)


class AuthorStatusBatchRequest(BaseModel):
    references: list[str] = Field(default_factory=list, max_length=50)
