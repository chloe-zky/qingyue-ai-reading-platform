from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class EditorialOverviewResponse(BaseModel):
    prompt_version: Optional[int] = None
    tag_vocabulary_version: Optional[int] = None
    strategy_version: Optional[int] = None
    draft_count: int = 0
    last_published_at: Optional[datetime] = None


class EditorialPromptSummary(BaseModel):
    id: str
    prompt_key: str
    name: str
    use_case: str
    description: str = ""
    status: str
    published_version: Optional[int] = None
    latest_draft_version: Optional[int] = None
    updated_at: Optional[datetime] = None


class EditorialStrategySummary(BaseModel):
    id: str
    strategy_key: str
    name: str
    use_case: str
    description: str = ""
    status: str
    published_version: Optional[int] = None
    latest_draft_version: Optional[int] = None
    updated_at: Optional[datetime] = None


class VocabularyVersionSummary(BaseModel):
    id: str
    version_no: int
    status: str
    change_note: str = ""
    category_count: int = 0
    created_at: Optional[datetime] = None
    published_at: Optional[datetime] = None


class AuditLogResponse(BaseModel):
    id: int
    actor_user_id: Optional[str] = None
    actor_role: Optional[str] = None
    domain: str
    action: str
    resource_type: str
    resource_id: Optional[str] = None
    summary: str = ""
    before_data: Optional[dict[str, Any]] = None
    after_data: Optional[dict[str, Any]] = None
    result: str
    created_at: datetime

