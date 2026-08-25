from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class ReaderProfileUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=40)
    personalization_enabled: Optional[bool] = None

    @field_validator("display_name")
    @classmethod
    def trim_display_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("昵称不能为空")
        return cleaned

    @model_validator(mode="after")
    def require_update(self):
        if self.display_name is None and self.personalization_enabled is None:
            raise ValueError("至少需要提供一项读者资料变更")
        return self


class ReaderProfileResponse(BaseModel):
    user_id: str
    email: str
    display_name: str
    reader_days: int
    favorites_count: int
    history_count: int
    personalization_enabled: bool = True
    created_at: datetime


class ReaderBookItem(BaseModel):
    book_id: int
    title: str
    author: str
    intro: str = ""
    full_content: str = ""
    cover_image_url: str = ""
    cover_photographer: str = ""
    cover_caption: str = ""
    progress_percent: Optional[int] = None
    saved_at: Optional[datetime] = None
    last_read_at: Optional[datetime] = None


class FavoriteStateResponse(BaseModel):
    book_id: int
    is_favorite: bool


class ReadingProgressUpdate(BaseModel):
    progress_percent: int = Field(ge=0, le=100)
    active_seconds_delta: int = Field(default=0, ge=0, le=120)
    opened: bool = False
    request_id: Optional[str] = Field(default=None, max_length=64)


class ReadingProgressResponse(BaseModel):
    book_id: int
    progress_percent: int
    active_seconds: int
    open_count: int
    completion_count: int
    last_read_at: datetime
