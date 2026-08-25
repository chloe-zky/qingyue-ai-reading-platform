import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.utils.auth import StaffPrincipal, StaffRole, require_review_editor


class ApiSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def setUp(self):
        self.review_editor = StaffPrincipal(
            user_id="11111111-1111-1111-1111-111111111111",
            email="editor@example.com",
            display_name="测试编辑",
            role=StaffRole.REVIEW_EDITOR,
        )

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_admin_book_creation_requires_token(self):
        response = self.client.post(
            "/api/books",
            json={
                "title": "测试",
                "author": "测试作者",
                "intro": "引子",
                "sample": "简介",
            },
        )
        self.assertEqual(response.status_code, 401)

    def test_editor_reject_route_matches_frontend_contract(self):
        expected = {
            "message": "稿件已拒稿，编辑意见已同步给作者。",
            "book_id": 8,
            "article_status": "rejected",
            "editor_feedback": "题材不符",
        }
        app.dependency_overrides[require_review_editor] = lambda: self.review_editor
        with patch(
            "app.routers.editor.reject_submission", return_value=expected
        ) as service, patch("app.routers.editor.write_audit_log"):
            response = self.client.post(
                "/api/editor/articles/8/reject",
                json={"reason": "题材不符"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)
        service.assert_called_once_with(8, "题材不符", self.review_editor.user_id)

    def test_editor_revise_route_matches_frontend_contract(self):
        expected = {
            "message": "稿件已退回修改，编辑意见已同步给作者。",
            "book_id": 9,
            "article_status": "revision_requested",
            "editor_feedback": "请补足结尾",
        }
        app.dependency_overrides[require_review_editor] = lambda: self.review_editor
        with patch(
            "app.routers.editor.request_submission_revision", return_value=expected
        ) as service, patch("app.routers.editor.write_audit_log"):
            response = self.client.post(
                "/api/editor/articles/9/revise",
                json={"note": "请补足结尾"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)
        service.assert_called_once_with(9, "请补足结尾", self.review_editor.user_id)

    def test_private_hotspot_origin_is_allowed_in_development(self):
        response = self.client.options(
            "/api/author/articles",
            headers={
                "Origin": "http://172.20.10.99:5173",
                "Access-Control-Request-Method": "POST",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers.get("access-control-allow-origin"),
            "http://172.20.10.99:5173",
        )

    def test_unlisted_public_origin_is_not_allowed(self):
        response = self.client.options(
            "/api/author/articles",
            headers={
                "Origin": "https://malicious.example",
                "Access-Control-Request-Method": "POST",
            },
        )
        self.assertNotEqual(
            response.headers.get("access-control-allow-origin"),
            "https://malicious.example",
        )

    def test_request_id_is_returned_and_accepts_safe_caller_value(self):
        response = self.client.get(
            "/api/health/live",
            headers={"X-Request-ID": "portfolio-check-123"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("x-request-id"), "portfolio-check-123")

    def test_invalid_request_id_is_replaced(self):
        response = self.client.get(
            "/api/health/live",
            headers={"X-Request-ID": "bad value with spaces"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertRegex(response.headers.get("x-request-id", ""), r"^[a-f0-9]{32}$")

    def test_readiness_reports_database_availability(self):
        query = MagicMock()
        query.select.return_value = query
        query.limit.return_value = query
        query.execute.return_value = SimpleNamespace(data=[])
        with patch("app.main.supabase.table", return_value=query):
            response = self.client.get("/api/health/ready")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["database"], "available")


if __name__ == "__main__":
    unittest.main()
