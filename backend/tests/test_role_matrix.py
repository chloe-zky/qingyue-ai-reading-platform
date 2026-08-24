import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.utils.auth import StaffPrincipal, StaffRole, get_current_staff


def principal(role: StaffRole) -> StaffPrincipal:
    return StaffPrincipal(
        user_id=f"00000000-0000-0000-0000-{role.value[-12:]:0>12}",
        email=f"{role.value}@example.com",
        display_name=role.value,
        role=role,
    )


class RoleMatrixApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def authenticate_as(self, role: StaffRole):
        current = principal(role)
        app.dependency_overrides[get_current_staff] = lambda: current
        return current

    def test_platform_admin_can_list_staff(self):
        self.authenticate_as(StaffRole.PLATFORM_ADMIN)
        with patch("app.routers.platform.list_staff_accounts", return_value=[]):
            response = self.client.get("/api/platform/staff")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"staff": []})

    def test_editorial_lead_cannot_list_staff(self):
        self.authenticate_as(StaffRole.EDITORIAL_LEAD)
        with patch("app.routers.platform.list_staff_accounts") as service:
            response = self.client.get("/api/platform/staff")
        self.assertEqual(response.status_code, 403)
        service.assert_not_called()

    def test_review_editor_cannot_list_staff(self):
        self.authenticate_as(StaffRole.REVIEW_EDITOR)
        with patch("app.routers.platform.list_staff_accounts") as service:
            response = self.client.get("/api/platform/staff")
        self.assertEqual(response.status_code, 403)
        service.assert_not_called()

    def test_editorial_lead_can_read_editorial_overview(self):
        self.authenticate_as(StaffRole.EDITORIAL_LEAD)
        overview = {
            "prompt_version": 2,
            "tag_vocabulary_version": 3,
            "strategy_version": 4,
            "draft_count": 1,
            "last_published_at": None,
        }
        with patch(
            "app.routers.editorial.get_editorial_overview",
            return_value=overview,
        ):
            response = self.client.get("/api/editorial/overview")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), overview)

    def test_platform_admin_cannot_read_editorial_configuration(self):
        self.authenticate_as(StaffRole.PLATFORM_ADMIN)
        with patch("app.routers.editorial.list_editorial_prompts") as service:
            response = self.client.get("/api/editorial/prompts")
        self.assertEqual(response.status_code, 403)
        service.assert_not_called()

    def test_review_editor_cannot_read_editorial_configuration(self):
        self.authenticate_as(StaffRole.REVIEW_EDITOR)
        with patch("app.routers.editorial.list_editorial_prompts") as service:
            response = self.client.get("/api/editorial/prompts")
        self.assertEqual(response.status_code, 403)
        service.assert_not_called()

    def test_review_editor_can_read_submission_queue(self):
        self.authenticate_as(StaffRole.REVIEW_EDITOR)
        with patch("app.routers.editor.get_pending_submissions", return_value=[]):
            response = self.client.get("/api/editor/submissions")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_review_editor_can_read_active_config_summary(self):
        self.authenticate_as(StaffRole.REVIEW_EDITOR)
        overview = {
            "prompt_version": 2,
            "tag_vocabulary_version": 3,
            "strategy_version": 4,
            "draft_count": 1,
            "last_published_at": None,
        }
        with patch(
            "app.routers.editor.get_editorial_overview",
            return_value=overview,
        ):
            response = self.client.get("/api/editor/config-summary")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), overview)

    def test_editorial_lead_cannot_read_review_config_summary(self):
        self.authenticate_as(StaffRole.EDITORIAL_LEAD)
        with patch("app.routers.editor.get_editorial_overview") as service:
            response = self.client.get("/api/editor/config-summary")
        self.assertEqual(response.status_code, 403)
        service.assert_not_called()

    def test_editorial_lead_cannot_process_submissions(self):
        self.authenticate_as(StaffRole.EDITORIAL_LEAD)
        with patch("app.routers.editor.get_pending_submissions") as service:
            response = self.client.get("/api/editor/submissions")
        self.assertEqual(response.status_code, 403)
        service.assert_not_called()

    def test_platform_admin_cannot_process_submissions(self):
        self.authenticate_as(StaffRole.PLATFORM_ADMIN)
        with patch("app.routers.editor.get_pending_submissions") as service:
            response = self.client.get("/api/editor/submissions")
        self.assertEqual(response.status_code, 403)
        service.assert_not_called()

    def test_each_role_can_resolve_its_own_session(self):
        for role in StaffRole:
            with self.subTest(role=role.value):
                current = self.authenticate_as(role)
                response = self.client.get("/api/internal/me")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["role"], role.value)
                self.assertEqual(response.json()["user_id"], current.user_id)


if __name__ == "__main__":
    unittest.main()
