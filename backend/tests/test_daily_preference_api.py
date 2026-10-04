import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app.main import app
from app.services.daily_preference_service import business_date
from app.services.recommendation_service import clear_recommendation_cache
from app.utils.reader_auth import ReaderPrincipal, get_current_reader
from test_daily_preference_service import VOCABULARY
from test_recommendation_service import RecommendationFakeSupabase, database


def principal(user_id="reader-1"):
    return ReaderPrincipal(
        user_id=user_id, email=f"{user_id}@example.com", display_name="读者"
    )


def fake_database():
    data = database()
    data["reader_daily_preferences"] = []
    return RecommendationFakeSupabase(data)


class DailyPreferenceApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def setUp(self):
        clear_recommendation_cache()
        self.fake = fake_database()
        patches = [
            patch("app.services.daily_preference_service.supabase", self.fake),
            patch("app.services.recommendation_service.supabase", self.fake),
            patch("app.services.personalization_service.supabase", self.fake),
            patch(
                "app.services.daily_preference_service.get_valid_vocabularies",
                return_value=dict(VOCABULARY),
            ),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)

    def tearDown(self):
        app.dependency_overrides.clear()
        clear_recommendation_cache()

    def sign_in(self, user_id="reader-1"):
        app.dependency_overrides[get_current_reader] = lambda: principal(user_id)

    def test_daily_state_requires_a_reader_token(self):
        self.assertEqual(self.client.get("/api/recommendations/daily").status_code, 401)
        self.assertEqual(
            self.client.put("/api/recommendations/daily", json={}).status_code, 401
        )

    def test_first_visit_of_the_day_reports_not_completed_and_no_results(self):
        self.sign_in()
        response = self.client.get("/api/recommendations/daily")
        payload = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertFalse(payload["completed"])
        self.assertEqual(payload["server_date"], business_date().isoformat())
        self.assertEqual(payload["results"], [])
        self.assertEqual(payload["selections"], {
            "setting_tags": [], "story_tone_tags": [], "relationship_core_tags": [],
        })

    def test_saving_returns_selections_and_recommendations_in_one_roundtrip(self):
        self.sign_in()
        response = self.client.put(
            "/api/recommendations/daily", json={"setting_tags": ["现代"]}
        )
        payload = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["completed"])
        self.assertEqual(payload["selections"]["setting_tags"], ["现代"])
        self.assertTrue(payload["results"])
        self.assertTrue(payload["request_id"])
        self.assertIn(payload["match_type"], {"exact", "mixed", "closest"})

    def test_revisiting_the_same_day_restores_the_stored_selection(self):
        self.sign_in()
        self.client.put("/api/recommendations/daily", json={"story_tone_tags": ["清甜校园"]})
        payload = self.client.get("/api/recommendations/daily").json()

        self.assertTrue(payload["completed"])
        self.assertEqual(payload["selections"]["story_tone_tags"], ["清甜校园"])
        self.assertTrue(payload["results"])

    def test_re_choosing_overwrites_the_same_day_without_adding_a_row(self):
        self.sign_in()
        self.client.put("/api/recommendations/daily", json={"setting_tags": ["现代"]})
        self.client.put("/api/recommendations/daily", json={"setting_tags": ["古风"]})
        payload = self.client.get("/api/recommendations/daily").json()

        self.assertEqual(payload["selections"]["setting_tags"], ["古风"])
        self.assertEqual(len(self.fake.tables["reader_daily_preferences"]), 1)

    def test_unpublished_tag_is_rejected_without_writing_anything(self):
        self.sign_in()
        response = self.client.put(
            "/api/recommendations/daily", json={"setting_tags": ["未来废土"]}
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.fake.tables["reader_daily_preferences"], [])

    def test_another_reader_sees_their_own_empty_day(self):
        self.sign_in("reader-1")
        self.client.put("/api/recommendations/daily", json={"setting_tags": ["现代"]})

        self.sign_in("reader-2")
        payload = self.client.get("/api/recommendations/daily").json()

        self.assertFalse(payload["completed"])
        self.assertEqual(payload["selections"]["setting_tags"], [])

    def test_another_reader_cannot_overwrite_an_existing_day(self):
        self.sign_in("reader-1")
        self.client.put("/api/recommendations/daily", json={"setting_tags": ["现代"]})
        self.sign_in("reader-2")
        self.client.put("/api/recommendations/daily", json={"setting_tags": ["古风"]})

        self.sign_in("reader-1")
        payload = self.client.get("/api/recommendations/daily").json()

        self.assertEqual(payload["selections"]["setting_tags"], ["现代"])
        self.assertEqual(len(self.fake.tables["reader_daily_preferences"]), 2)

    def test_skipping_every_step_is_stored_as_a_completed_empty_day(self):
        self.sign_in()
        saved = self.client.put("/api/recommendations/daily", json={}).json()
        restored = self.client.get("/api/recommendations/daily").json()

        self.assertTrue(saved["completed"])
        self.assertTrue(restored["completed"])
        self.assertEqual(restored["selections"]["setting_tags"], [])
        self.assertEqual(restored["match_type"], "cold_start")

    def test_dropped_connection_is_retryable_and_never_reads_as_a_new_day(self):
        # The discovery page must be able to tell "today has no record" from
        # "this request failed": the first shows the three steps, the second
        # must not, or a re-selection would overwrite the stored day.
        self.sign_in()
        with patch(
            "app.routers.recommendations.get_today_selections",
            side_effect=httpx.ReadError("[Errno 35] Resource temporarily unavailable"),
        ):
            response = self.client.get("/api/recommendations/daily")

        self.assertEqual(response.status_code, 503)
        self.assertNotIn("completed", response.json())

    def test_dropped_connection_while_saving_is_also_retryable(self):
        self.sign_in()
        with patch(
            "app.routers.recommendations.save_today_selections",
            side_effect=httpx.ReadError("[Errno 35] Resource temporarily unavailable"),
        ):
            response = self.client.put(
                "/api/recommendations/daily", json={"setting_tags": ["现代"]}
            )

        self.assertEqual(response.status_code, 503)

    def test_anonymous_recommendation_endpoint_stays_compatible(self):
        response = self.client.post(
            "/api/recommendations",
            json={"setting_tags": ["现代"], "story_tone_tags": [], "relationship_core_tags": []},
        )
        payload = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertIn("request_id", payload)
        self.assertIn("results", payload)
        self.assertIn("match_type", payload)


if __name__ == "__main__":
    unittest.main()
