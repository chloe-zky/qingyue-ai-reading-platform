from typing import List

from pydantic import BaseModel, Field, field_validator

class UserPreferences(BaseModel):
    setting_tags: List[str] = Field(default_factory=list, max_length=20)
    story_tone_tags: List[str] = Field(default_factory=list, max_length=20)
    relationship_core_tags: List[str] = Field(default_factory=list, max_length=20)

    @field_validator("setting_tags", "story_tone_tags", "relationship_core_tags")
    @classmethod
    def clean_tags(cls, values: List[str]) -> List[str]:
        cleaned = []
        for value in values:
            tag = str(value).strip()
            if not tag:
                continue
            if len(tag) > 40:
                raise ValueError("单个偏好标签不能超过 40 个字符")
            if tag not in cleaned:
                cleaned.append(tag)
        return cleaned
