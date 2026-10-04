from pydantic import BaseModel, ConfigDict, Field
from typing import Optional

class BookSearchItem(BaseModel):
    """搜索结果卡片。只暴露公开展示字段，正文与审核字段一概不出现。"""

    book_id: int
    id: int
    title: str
    author: str
    intro: str = ""
    cover_image_url: str = ""
    cover_photographer: str = ""
    cover_caption: str = ""


class BookCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=120)
    author: str = Field(min_length=1, max_length=80)
    intro: str = Field(min_length=1, max_length=1000)
    sample: str = Field(min_length=1, max_length=5000)
    full_content: Optional[str] = Field(default="", max_length=500_000)
