from pydantic import BaseModel, Field
from typing import List, Optional

class TagsSchema(BaseModel):
    setting_tags: List[str] = Field(default_factory=list)
    story_tone_tags: List[str] = Field(default_factory=list)
    relationship_core_tags: List[str] = Field(default_factory=list)
    aesthetic_tags: List[str] = Field(default_factory=list)
    risk_tags: List[str] = Field(default_factory=list)
    recommend_reason: Optional[str] = ""
