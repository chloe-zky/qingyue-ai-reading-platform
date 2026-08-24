from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.utils.auth import StaffRole


class InviteStaffRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    email: str = Field(min_length=3, max_length=320)
    display_name: str = Field(min_length=1, max_length=80)
    role: StaffRole

    @field_validator("email")
    @classmethod
    def validate_email_shape(cls, value: str) -> str:
        local, separator, domain = value.strip().lower().partition("@")
        if not separator or not local or "." not in domain:
            raise ValueError("请输入有效的工作邮箱")
        return value.strip().lower()


class UpdateStaffRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    display_name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    role: Optional[StaffRole] = None
    status: Optional[str] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and value not in {"active", "disabled"}:
            raise ValueError("status 只能是 active 或 disabled")
        return value

    @field_validator("display_name")
    @classmethod
    def reject_blank_name(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and not value.strip():
            raise ValueError("员工姓名不能为空")
        return value


class StaffAccountResponse(BaseModel):
    user_id: str
    email: str = ""
    display_name: str
    role: StaffRole
    status: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    last_sign_in_at: Optional[datetime] = None


class StaffListResponse(BaseModel):
    staff: list[StaffAccountResponse]


class InviteStaffResponse(BaseModel):
    message: str
    staff: StaffAccountResponse

