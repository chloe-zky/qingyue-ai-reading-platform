import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import ValidationError

from app.schemas.admin import UpdateLLMConfigRequest
from app.schemas.editor import ApproveArticleRequest
from app.schemas.editorial import (
    PromptDraftRequest,
    PromptTestRequest,
    StrategyDraftRequest,
    StrategySimulationRequest,
)
from app.schemas.feedback import FeedbackCreate
from app.schemas.recommendation import UserPreferences
from app.schemas.reader import ReaderProfileUpdate, ReadingProgressUpdate
from app.utils.auth import (
    StaffPrincipal,
    StaffRole,
    get_current_staff,
    require_editorial_lead,
)
from app.utils.outbound_url import validate_llm_api_base


class EditorSchemaTests(unittest.TestCase):
    def test_cleans_and_deduplicates_tags(self):
        request = ApproveArticleRequest(setting_tags=[" 现代 ", "现代", ""])
        self.assertEqual(request.setting_tags, ["现代"])

    def test_rejects_oversized_tag(self):
        with self.assertRaises(ValidationError):
            ApproveArticleRequest(setting_tags=["x" * 41])

    def test_prompt_draft_rejects_manuscript_body_variable(self):
        with self.assertRaises(ValidationError):
            PromptDraftRequest(
                name="元数据打标",
                system_prompt="只分析公开元数据",
                user_prompt_template="正文：{{content}}",
                variables=["content"],
            )

    def test_strategy_draft_requires_weights_to_total_100(self):
        with self.assertRaises(ValidationError):
            StrategyDraftRequest(
                name="错误权重",
                setting_weight=10,
                story_tone_weight=20,
                relationship_core_weight=30,
            )

    def test_prompt_test_rejects_manuscript_body_variable(self):
        with self.assertRaises(ValidationError):
            PromptTestRequest(
                system_prompt="测试",
                user_prompt_template="{{content}}",
                variables=["content"],
                title="标题",
            )

    def test_strategy_simulation_requires_a_preference(self):
        with self.assertRaises(ValidationError):
            StrategySimulationRequest(
                setting_weight=15,
                story_tone_weight=40,
                relationship_core_weight=45,
            )

    def test_llm_base_requires_https(self):
        with self.assertRaises(ValidationError):
            UpdateLLMConfigRequest(
                api_base="http://example.com/v1",
                model_name="example-model",
            )

    def test_llm_base_rejects_private_literal(self):
        with self.assertRaisesRegex(ValueError, "私网"):
            validate_llm_api_base("https://127.0.0.1/v1", resolve_dns=False)


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

    def test_reader_profile_update_requires_a_change(self):
        with self.assertRaises(ValidationError):
            ReaderProfileUpdate()

    def test_active_reading_delta_is_bounded(self):
        with self.assertRaises(ValidationError):
            ReadingProgressUpdate(
                progress_percent=20, active_seconds_delta=121
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
