import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.schemas.platform import UpdateStaffRequest
from app.services.platform_service import (
    StaffAccountConflictError,
    StorageHealthError,
    check_storage_health,
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
        ), patch("app.services.platform_service.supabase") as fake:
            fake.rpc.return_value.execute.side_effect = RuntimeError(
                "last active platform admin"
            )
            with self.assertRaises(StaffAccountConflictError):
                update_staff_account(
                    target_id,
                    UpdateStaffRequest(role=StaffRole.EDITORIAL_LEAD),
                    self.actor,
                )

    def test_staff_identity_update_uses_atomic_database_function(self):
        target_id = "22222222-2222-2222-2222-222222222222"
        current = {
            "user_id": target_id,
            "display_name": "旧名字",
            "role": StaffRole.EDITORIAL_LEAD.value,
            "status": "active",
        }
        updated = {**current, "display_name": "新名字"}
        fake = MagicMock()
        fake.rpc.return_value.execute.return_value = SimpleNamespace(
            data={"before": current, "after": updated}
        )

        with patch(
            "app.services.platform_service._get_staff_profile",
            return_value=current,
        ), patch(
            "app.services.platform_service._auth_users_by_id",
            return_value={},
        ), patch("app.services.platform_service.supabase", fake):
            before, result = update_staff_account(
                target_id,
                UpdateStaffRequest(display_name="新名字"),
                self.actor,
            )

        name, payload = fake.rpc.call_args.args
        self.assertEqual(name, "update_staff_account_atomic")
        self.assertEqual(payload["p_actor"], self.actor.user_id)
        self.assertEqual(payload["p_target"], target_id)
        self.assertEqual(payload["p_display_name"], "新名字")
        self.assertEqual(before["display_name"], "旧名字")
        self.assertEqual(result["display_name"], "新名字")


class PlatformStorageHealthTests(unittest.TestCase):
    def test_storage_probe_only_lists_buckets(self):
        storage = MagicMock()
        storage.list_buckets.return_value = [{"name": "covers"}]
        fake_supabase = MagicMock()
        fake_supabase.storage = storage
        with patch("app.services.platform_service.supabase", fake_supabase):
            result = check_storage_health()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["bucket"], "covers")
        storage.list_buckets.assert_called_once_with()

    def test_storage_probe_reports_missing_bucket(self):
        storage = MagicMock()
        storage.list_buckets.return_value = [{"name": "other"}]
        fake_supabase = MagicMock()
        fake_supabase.storage = storage
        with patch("app.services.platform_service.supabase", fake_supabase):
            with self.assertRaisesRegex(StorageHealthError, "covers"):
                check_storage_health()


if __name__ == "__main__":
    unittest.main()
