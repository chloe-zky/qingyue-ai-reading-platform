import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import ValidationError

from app.schemas.editor import ApproveArticleRequest
from app.schemas.feedback import FeedbackCreate
from app.schemas.recommendation import UserPreferences
from app.utils.auth import (
    StaffPrincipal,
    StaffRole,
    get_current_staff,
    require_editorial_lead,
)


class EditorSchemaTests(unittest.TestCase):
    def test_cleans_and_deduplicates_tags(self):
        request = ApproveArticleRequest(setting_tags=[" 现代 ", "现代", ""])
        self.assertEqual(request.setting_tags, ["现代"])

    def test_rejects_oversized_tag(self):
        with self.assertRaises(ValidationError):
            ApproveArticleRequest(setting_tags=["x" * 41])


class PublicSchemaTests(unittest.TestCase):
    def test_recommendation_tags_are_cleaned(self):
        prefs = UserPreferences(setting_tags=[" 现代 ", "现代", ""])
        self.assertEqual(prefs.setting_tags, ["现代"])

    def test_feedback_reason_uses_known_values(self):
        with self.assertRaises(ValidationError):
            FeedbackCreate(
                request_id="request-1",
                book_id=1,
                book_title="测试作品",
                reason="任意文本",
                user_prefs={},
            )


class StaffAuthTests(unittest.TestCase):
    def test_resolves_supabase_user_and_staff_role(self):
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer", credentials="valid-access-token"
        )
        auth_user = SimpleNamespace(
            id="11111111-1111-1111-1111-111111111111",
            email="lead@example.com",
        )
        profile = {
            "user_id": auth_user.id,
            "display_name": "编辑部负责人",
            "role": "editorial_lead",
            "status": "active",
        }

        with patch("app.utils.auth._load_auth_user", return_value=auth_user), patch(
            "app.utils.auth._load_staff_profile", return_value=profile
        ):
            principal = get_current_staff(credentials)

        self.assertEqual(principal.role, StaffRole.EDITORIAL_LEAD)
        self.assertEqual(principal.email, "lead@example.com")

    def test_missing_bearer_token_is_unauthorized(self):
        with self.assertRaises(HTTPException) as raised:
            get_current_staff(None)
        self.assertEqual(raised.exception.status_code, 401)

    def test_role_guard_rejects_other_staff_role(self):
        principal = StaffPrincipal(
            user_id="11111111-1111-1111-1111-111111111111",
            email="admin@example.com",
            display_name="平台管理员",
            role=StaffRole.PLATFORM_ADMIN,
        )
        with self.assertRaises(HTTPException) as raised:
            require_editorial_lead(principal)
        self.assertEqual(raised.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
