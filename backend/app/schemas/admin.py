from typing import Literal, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

class UpdateLLMConfigRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    api_base: str = Field(min_length=8, max_length=2048)
    # 留空/省略表示保留数据库中的现有密钥；首次配置仍必须提供。
    api_key: Optional[str] = Field(default=None, min_length=1, max_length=4096)
    model_name: str = Field(default="gemini-2.5-pro", min_length=1, max_length=120)
    api_type: Literal["openai_compatible"] = "openai_compatible"
    # 省略时保留当前值，便于不同终端按需提交局部配置。
    timeout_seconds: Optional[int] = Field(default=None, ge=1, le=300)
    max_retries: Optional[int] = Field(default=None, ge=0, le=10)

    @field_validator("api_key", mode="before")
    @classmethod
    def blank_api_key_means_keep_existing(cls, value):
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("api_base")
    @classmethod
    def validate_api_base(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("API Base 必须是有效的 HTTP(S) 地址")
        return value.rstrip("/")
