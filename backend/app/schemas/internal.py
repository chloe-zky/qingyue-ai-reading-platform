from pydantic import BaseModel

from app.utils.auth import StaffPrincipal, StaffRole


class StaffSessionResponse(BaseModel):
    user_id: str
    email: str
    display_name: str
    role: StaffRole

    @classmethod
    def from_principal(cls, principal: StaffPrincipal) -> "StaffSessionResponse":
        return cls(
            user_id=principal.user_id,
            email=principal.email,
            display_name=principal.display_name,
            role=principal.role,
        )

