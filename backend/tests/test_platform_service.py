import unittest
from unittest.mock import patch

from app.schemas.platform import UpdateStaffRequest
from app.services.platform_service import (
    StaffAccountConflictError,
    update_staff_account,
)
from app.utils.auth import StaffPrincipal, StaffRole


class PlatformStaffSafetyTests(unittest.TestCase):
    def setUp(self):
        self.actor = StaffPrincipal(
            user_id="11111111-1111-1111-1111-111111111111",
            email="admin@example.com",
            display_name="平台管理员",
            role=StaffRole.PLATFORM_ADMIN,
        )

    def test_platform_admin_cannot_disable_self(self):
        current = {
            "user_id": self.actor.user_id,
            "display_name": self.actor.display_name,
            "role": StaffRole.PLATFORM_ADMIN.value,
            "status": "active",
        }
        with patch(
            "app.services.platform_service._get_staff_profile",
            return_value=current,
        ):
            with self.assertRaises(StaffAccountConflictError):
                update_staff_account(
                    self.actor.user_id,
                    UpdateStaffRequest(status="disabled"),
                    self.actor,
                )

    def test_cannot_remove_last_active_platform_admin(self):
        target_id = "22222222-2222-2222-2222-222222222222"
        current = {
            "user_id": target_id,
            "display_name": "备用管理员",
            "role": StaffRole.PLATFORM_ADMIN.value,
            "status": "active",
        }
        with patch(
            "app.services.platform_service._get_staff_profile",
            return_value=current,
        ), patch(
            "app.services.platform_service._active_platform_admin_count",
            return_value=1,
        ):
            with self.assertRaises(StaffAccountConflictError):
                update_staff_account(
                    target_id,
                    UpdateStaffRequest(role=StaffRole.EDITORIAL_LEAD),
                    self.actor,
                )


if __name__ == "__main__":
    unittest.main()

