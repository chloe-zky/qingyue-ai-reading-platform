import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.utils.reader_auth import ReaderPrincipal, get_current_reader


class ReaderApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_profile_requires_reader_bearer_token(self):
        response = self.client.get("/api/reader/me")
        self.assertEqual(response.status_code, 401)

    def test_authenticated_reader_can_read_profile(self):
        current = ReaderPrincipal(
            user_id="reader-1", email="reader@example.com", display_name="读者"
        )
        app.dependency_overrides[get_current_reader] = lambda: current
        profile = {
            "user_id": current.user_id,
            "email": current.email,
            "display_name": "读者",
            "reader_days": 1,
            "favorites_count": 0,
            "history_count": 0,
            "personalization_enabled": True,
            "created_at": "2026-08-25T00:00:00+00:00",
        }
        with patch(
            "app.routers.readers.get_reader_profile", return_value=profile
        ) as service:
            response = self.client.get("/api/reader/me")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["email"], current.email)
        service.assert_called_once_with(current)

    def test_progress_validation_rejects_out_of_range_value(self):
        current = ReaderPrincipal(
            user_id="reader-1", email="reader@example.com", display_name="读者"
        )
        app.dependency_overrides[get_current_reader] = lambda: current
        with patch("app.routers.readers.save_reading_progress") as service:
            response = self.client.put(
                "/api/reader/history/1", json={"progress_percent": 101}
            )
        self.assertEqual(response.status_code, 422)
        service.assert_not_called()

    def test_progress_accepts_aggregated_engagement_fields(self):
        current = ReaderPrincipal(
            user_id="reader-1", email="reader@example.com", display_name="读者"
        )
        app.dependency_overrides[get_current_reader] = lambda: current
        result = {
            "book_id": 1,
            "progress_percent": 45,
            "active_seconds": 30,
            "open_count": 1,
            "completion_count": 0,
            "last_read_at": "2026-08-25T00:00:00+00:00",
        }
        with patch(
            "app.routers.readers.save_reading_progress", return_value=result
        ) as service:
            response = self.client.put(
                "/api/reader/history/1",
                json={
                    "progress_percent": 45,
                    "active_seconds_delta": 30,
                    "opened": True,
                    "request_id": "request-1",
                },
            )
        self.assertEqual(response.status_code, 200)
        service.assert_called_once_with(
            current, 1, 45, 30, True, "request-1"
        )


if __name__ == "__main__":
    unittest.main()
