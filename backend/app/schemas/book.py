from pydantic import BaseModel, ConfigDict, Field
from typing import Optional

class BookCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=120)
    author: str = Field(min_length=1, max_length=80)
    intro: str = Field(min_length=1, max_length=1000)
    sample: str = Field(min_length=1, max_length=5000)
    full_content: Optional[str] = Field(default="", max_length=500_000)
