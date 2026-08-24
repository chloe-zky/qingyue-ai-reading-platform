from typing import Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

class FeedbackCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    request_id: str = Field(min_length=1, max_length=64)
    book_id: int = Field(gt=0)
    book_title: str = Field(min_length=1, max_length=120)
    reason: Literal["推荐准确", "不感兴趣", "标签不准", "风格不符"]
    user_prefs: Dict
    feedback_note: Optional[str] = Field(default="", max_length=1000)
