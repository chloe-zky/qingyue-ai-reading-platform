from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


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
    actor_display_name: Optional[str] = None
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


class VersionMutationResponse(BaseModel):
    message: str
    version_no: int
    status: Literal["draft", "published", "archived"]


class PublishVersionRequest(BaseModel):
    version_no: int = Field(gt=0)


class RollbackVersionRequest(BaseModel):
    target_version_no: int = Field(gt=0)
    change_note: str = Field(default="回滚至历史版本", max_length=500)


class PromptDraftRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    system_prompt: str = Field(min_length=1, max_length=20000)
    user_prompt_template: str = Field(min_length=1, max_length=20000)
    variables: list[str] = Field(default_factory=list, max_length=20)
    change_note: str = Field(default="", max_length=500)
    expected_version_no: Optional[int] = Field(default=None, gt=0)

    @field_validator("name", "description", "system_prompt", "user_prompt_template", "change_note")
    @classmethod
    def trim_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("variables")
    @classmethod
    def validate_variables(cls, values: list[str]) -> list[str]:
        allowed = {"title", "intro", "sample"}
        cleaned: list[str] = []
        for value in values:
            item = str(value).strip()
            if item not in allowed:
                raise ValueError("Prompt 仅允许使用 title、intro、sample 变量")
            if item not in cleaned:
                cleaned.append(item)
        return cleaned


class PromptVersionDetail(BaseModel):
    id: str
    version_no: int
    status: str
    system_prompt: str
    user_prompt_template: str
    variables: list[str] = Field(default_factory=list)
    change_note: str = ""
    created_at: Optional[datetime] = None
    published_at: Optional[datetime] = None


class EditorialPromptDetail(EditorialPromptSummary):
    versions: list[PromptVersionDetail] = Field(default_factory=list)


class PromptTestRequest(BaseModel):
    system_prompt: str = Field(min_length=1, max_length=20000)
    user_prompt_template: str = Field(min_length=1, max_length=20000)
    variables: list[str] = Field(default_factory=list, max_length=20)
    title: str = Field(min_length=1, max_length=200)
    intro: str = Field(default="", max_length=2000)
    sample: str = Field(default="", max_length=10000)

    @field_validator(
        "system_prompt", "user_prompt_template", "title", "intro", "sample"
    )
    @classmethod
    def trim_prompt_test_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("variables")
    @classmethod
    def validate_test_variables(cls, values: list[str]) -> list[str]:
        return PromptDraftRequest.validate_variables(values)


class PromptTestResponse(BaseModel):
    output: dict[str, Any]
    model_name: str


class StrategyDraftRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    setting_weight: int = Field(ge=0, le=100)
    story_tone_weight: int = Field(ge=0, le=100)
    relationship_core_weight: int = Field(ge=0, le=100)
    max_score: int = Field(default=96, ge=1, le=100)
    result_limit: int = Field(default=6, ge=1, le=50)
    change_note: str = Field(default="", max_length=500)
    expected_version_no: Optional[int] = Field(default=None, gt=0)

    @field_validator("name", "description", "change_note")
    @classmethod
    def trim_strategy_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_weight_total(self):
        total = (
            self.setting_weight
            + self.story_tone_weight
            + self.relationship_core_weight
        )
        if total != 100:
            raise ValueError("三项推荐权重之和必须为 100")
        return self


class StrategyVersionDetail(BaseModel):
    id: str
    version_no: int
    status: str
    settings: dict[str, Any] = Field(default_factory=dict)
    change_note: str = ""
    created_at: Optional[datetime] = None
    published_at: Optional[datetime] = None


class EditorialStrategyDetail(EditorialStrategySummary):
    versions: list[StrategyVersionDetail] = Field(default_factory=list)


class StrategySimulationRequest(BaseModel):
    setting_weight: int = Field(ge=0, le=100)
    story_tone_weight: int = Field(ge=0, le=100)
    relationship_core_weight: int = Field(ge=0, le=100)
    max_score: int = Field(default=96, ge=1, le=100)
    result_limit: int = Field(default=6, ge=1, le=50)
    setting_tags: list[str] = Field(default_factory=list, max_length=20)
    story_tone_tags: list[str] = Field(default_factory=list, max_length=20)
    relationship_core_tags: list[str] = Field(default_factory=list, max_length=20)

    @field_validator(
        "setting_tags", "story_tone_tags", "relationship_core_tags"
    )
    @classmethod
    def clean_simulation_tags(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        for value in values:
            item = str(value).strip()
            if item and item not in cleaned:
                if len(item) > 40:
                    raise ValueError("单个偏好标签不能超过 40 个字符")
                cleaned.append(item)
        return cleaned

    @model_validator(mode="after")
    def validate_simulation_weights(self):
        total = (
            self.setting_weight
            + self.story_tone_weight
            + self.relationship_core_weight
        )
        if total != 100:
            raise ValueError("三项推荐权重之和必须为 100")
        if not (
            self.setting_tags
            or self.story_tone_tags
            or self.relationship_core_tags
        ):
            raise ValueError("策略模拟至少需要一个偏好标签")
        return self


class StrategySimulationResult(BaseModel):
    book_id: int
    title: str
    author: str
    score: int
    matched_tags: dict[str, list[str]] = Field(default_factory=dict)


class StrategySimulationResponse(BaseModel):
    results: list[StrategySimulationResult] = Field(default_factory=list)
    candidate_count: int = 0


class VocabularyTermDetail(BaseModel):
    id: str
    term_key: str
    name: str
    description: str = ""
    synonyms: list[str] = Field(default_factory=list)
    sort_order: int = 0
    status: str


class VocabularyCategoryDetail(BaseModel):
    id: str
    category_key: str
    name: str
    description: str = ""
    sort_order: int = 0
    status: str
    terms: list[VocabularyTermDetail] = Field(default_factory=list)


class VocabularyVersionDetail(VocabularyVersionSummary):
    categories: list[VocabularyCategoryDetail] = Field(default_factory=list)


class VocabularyDraftRequest(BaseModel):
    change_note: str = Field(default="基于当前发布版本创建草稿", max_length=500)

    @field_validator("change_note")
    @classmethod
    def trim_vocabulary_note(cls, value: str) -> str:
        return value.strip()


class VocabularyTermUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    synonyms: list[str] = Field(default_factory=list, max_length=30)
    status: Literal["active", "disabled"] = "active"

    @field_validator("name", "description")
    @classmethod
    def trim_term_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("synonyms")
    @classmethod
    def clean_synonyms(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        for value in values:
            item = str(value).strip()
            if item and item not in cleaned:
                cleaned.append(item)
        return cleaned


class VocabularyTermCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    synonyms: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("name", "description")
    @classmethod
    def trim_new_term_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("synonyms")
    @classmethod
    def clean_new_term_synonyms(cls, values: list[str]) -> list[str]:
        return VocabularyTermUpdateRequest.clean_synonyms(values)
