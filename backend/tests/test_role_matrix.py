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

    def test_platform_admin_can_test_llm_connection(self):
        self.authenticate_as(StaffRole.PLATFORM_ADMIN)
        result = {
            "status": "ok",
            "model_name": "example-model",
            "latency_ms": 42,
            "message": "连接成功",
        }
        with patch(
            "app.routers.admin.test_llm_connection", return_value=result
        ) as service, patch("app.routers.admin.write_audit_log"), patch(
            "app.utils.outbound_url.LLM_ALLOWED_HOSTS", ()
        ):
            response = self.client.post(
                "/api/platform/llm-config/test",
                json={
                    "api_base": "https://example.com/v1",
                    "model_name": "example-model",
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), result)
        service.assert_called_once()

    def test_editorial_lead_cannot_test_llm_connection(self):
        self.authenticate_as(StaffRole.EDITORIAL_LEAD)
        with patch("app.routers.admin.test_llm_connection") as service:
            response = self.client.post(
                "/api/platform/llm-config/test",
                json={
                    "api_base": "https://example.com/v1",
                    "model_name": "example-model",
                },
            )
        self.assertEqual(response.status_code, 403)
        service.assert_not_called()

    def test_platform_admin_can_refresh_llm_models(self):
        self.authenticate_as(StaffRole.PLATFORM_ADMIN)
        result = {"models": ["gemini-3-flash-preview", "gemini-3.5-flash"], "count": 2}
        with patch(
            "app.routers.admin.list_available_llm_models", return_value=result
        ) as service, patch("app.utils.outbound_url.LLM_ALLOWED_HOSTS", ()):
            response = self.client.post(
                "/api/platform/llm-config/models",
                json={"api_base": "https://example.com/v1"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), result)
        service.assert_called_once()

    def test_review_editor_cannot_refresh_llm_models(self):
        self.authenticate_as(StaffRole.REVIEW_EDITOR)
        with patch("app.routers.admin.list_available_llm_models") as service:
            response = self.client.post(
                "/api/platform/llm-config/models",
                json={"api_base": "https://example.com/v1"},
            )
        self.assertEqual(response.status_code, 403)
        service.assert_not_called()

    def test_platform_admin_can_check_storage(self):
        self.authenticate_as(StaffRole.PLATFORM_ADMIN)
        result = {
            "status": "ok",
            "bucket": "covers",
            "latency_ms": 12,
            "message": "可访问",
        }
        with patch("app.routers.platform.check_storage_health", return_value=result):
            response = self.client.get("/api/platform/storage-health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), result)

    def test_review_editor_cannot_check_storage(self):
        self.authenticate_as(StaffRole.REVIEW_EDITOR)
        with patch("app.routers.platform.check_storage_health") as service:
            response = self.client.get("/api/platform/storage-health")
        self.assertEqual(response.status_code, 403)
        service.assert_not_called()

    def test_platform_admin_can_filter_audit_logs(self):
        self.authenticate_as(StaffRole.PLATFORM_ADMIN)
        with patch(
            "app.routers.platform.list_audit_logs", return_value=[]
        ) as service:
            response = self.client.get(
                "/api/platform/audit-logs?domain=auth&result=failure&q=invite&hours=168"
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])
        self.assertEqual(service.call_args.kwargs["domains"], ["auth"])
        self.assertEqual(service.call_args.kwargs["result"], "failure")
        self.assertEqual(service.call_args.kwargs["search"], "invite")

    def test_platform_audit_log_rejects_unknown_domain(self):
        self.authenticate_as(StaffRole.PLATFORM_ADMIN)
        with patch("app.routers.platform.list_audit_logs") as service:
            response = self.client.get(
                "/api/platform/audit-logs?domain=editorial"
            )
        self.assertEqual(response.status_code, 422)
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

    def test_editorial_lead_can_filter_audit_logs(self):
        self.authenticate_as(StaffRole.EDITORIAL_LEAD)
        with patch(
            "app.routers.editorial.list_audit_logs", return_value=[]
        ) as service:
            response = self.client.get(
                "/api/editorial/audit-logs?action_prefix=prompt&action_contains=publish&q=v2"
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])
        self.assertEqual(service.call_args.kwargs["action_prefix"], "prompt")
        self.assertEqual(service.call_args.kwargs["action_contains"], "publish")
        self.assertEqual(service.call_args.kwargs["search"], "v2")

    def test_editorial_lead_can_publish_prompt_draft(self):
        current = self.authenticate_as(StaffRole.EDITORIAL_LEAD)
        result = {"message": "Prompt 版本已发布。", "version_no": 2, "status": "published"}
        with patch(
            "app.routers.editorial.publish_prompt_version", return_value=result
        ) as service:
            response = self.client.post(
                "/api/editorial/prompts/prompt-1/publish",
                json={"version_no": 2},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), result)
        service.assert_called_once_with("prompt-1", 2, current)

    def test_review_editor_cannot_publish_prompt_draft(self):
        self.authenticate_as(StaffRole.REVIEW_EDITOR)
        with patch("app.routers.editorial.publish_prompt_version") as service:
            response = self.client.post(
                "/api/editorial/prompts/prompt-1/publish",
                json={"version_no": 2},
            )
        self.assertEqual(response.status_code, 403)
        service.assert_not_called()

    def test_editorial_lead_can_run_strategy_simulation(self):
        current = self.authenticate_as(StaffRole.EDITORIAL_LEAD)
        result = {"results": [], "candidate_count": 0}
        with patch(
            "app.routers.editorial.simulate_strategy", return_value=result
        ) as service:
            response = self.client.post(
                "/api/editorial/strategies/strategy-1/simulate",
                json={
                    "setting_weight": 15,
                    "story_tone_weight": 40,
                    "relationship_core_weight": 45,
                    "setting_tags": ["现代"],
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), result)
        service.assert_called_once()
        self.assertEqual(service.call_args.args[0], "strategy-1")
        self.assertEqual(service.call_args.args[2], current)

    def test_review_editor_cannot_run_strategy_simulation(self):
        self.authenticate_as(StaffRole.REVIEW_EDITOR)
        with patch("app.routers.editorial.simulate_strategy") as service:
            response = self.client.post(
                "/api/editorial/strategies/strategy-1/simulate",
                json={
                    "setting_weight": 15,
                    "story_tone_weight": 40,
                    "relationship_core_weight": 45,
                    "setting_tags": ["现代"],
                },
            )
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
