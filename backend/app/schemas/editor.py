from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ApproveArticleRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    # 标签（沿用）
    setting_tags: List[str] = Field(default_factory=list, max_length=20)
    story_tone_tags: List[str] = Field(default_factory=list, max_length=20)
    relationship_core_tags: List[str] = Field(default_factory=list, max_length=20)
    aesthetic_tags: List[str] = Field(default_factory=list, max_length=20)
    risk_tags: List[str] = Field(default_factory=list, max_length=20)
    recommend_reason: Optional[str] = Field(default="", max_length=1000)

    # 编辑配图三件套——审稿阶段由编辑部填写，仅用于前台展示，绝不参与 AI 打标。
    cover_image_url: Optional[str] = Field(default="", max_length=2048)
    cover_photographer: Optional[str] = Field(default="", max_length=120)
    cover_caption: Optional[str] = Field(default="", max_length=500)

    @field_validator(
        "setting_tags",
        "story_tone_tags",
        "relationship_core_tags",
        "aesthetic_tags",
        "risk_tags",
    )
    @classmethod
    def clean_tags(cls, values: List[str]) -> List[str]:
        cleaned = []
        for value in values:
            tag = str(value).strip()
            if not tag:
                continue
            if len(tag) > 40:
                raise ValueError("单个标签不能超过 40 个字符")
            if tag not in cleaned:
                cleaned.append(tag)
        return cleaned


class RejectArticleRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    reason: str = Field(min_length=1, max_length=2000)


class ReviseArticleRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    note: str = Field(min_length=1, max_length=2000)


class ReviewClaimResponse(BaseModel):
    book_id: int
    claimed: bool
    expires_at: Optional[str] = None
