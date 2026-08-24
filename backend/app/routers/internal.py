from fastapi import APIRouter, Depends

from app.schemas.internal import StaffSessionResponse
from app.utils.auth import StaffPrincipal, get_current_staff


router = APIRouter(prefix="/api/internal", tags=["Internal Auth"])


@router.get("/me", response_model=StaffSessionResponse)
def get_my_staff_session(
    principal: StaffPrincipal = Depends(get_current_staff),
) -> StaffSessionResponse:
    return StaffSessionResponse.from_principal(principal)

