import unittest
from unittest.mock import patch

from app.schemas.recommendation import UserPreferences
from app.services.recommendation_service import get_recommendations
from app.utils.reader_auth import ReaderPrincipal
from test_reader_service import FakeSupabase


def principal():
    return ReaderPrincipal(
        user_id="reader-1", email="reader@example.com", display_name="读者"
    )


def database():
    return {
        "editorial_strategies": [{
            "id": "strategy-1",
            "strategy_key": "emotional_tag_match",
            "status": "active",
        }],
        "editorial_strategy_versions": [{
            "strategy_id": "strategy-1",
            "version_no": 1,
            "status": "published",
            "settings": {
                "weights": {
                    "setting": 15,
                    "story_tone": 40,
                    "relationship_core": 45,
                },
                "max_score": 96,
                "result_limit": 6,
                "cold_start": {"limit": 10},
            },
        }],
        "recommendation_strategies": [],
        "books": [
            {"id": 1, "title": "春日", "author": "林夏", "intro": "重逢", "status": "active", "created_at": "2026-08-25T00:00:00+00:00"},
            {"id": 2, "title": "夏夜", "author": "周青", "intro": "校园", "status": "active", "created_at": "2026-08-24T00:00:00+00:00"},
        ],
        "book_ai_tags": [
            {"book_id": 1, "setting_tags": ["现代"], "story_tone_tags": ["温暖治愈"], "relationship_core_tags": ["久别重逢"], "tag_status": "confirmed", "created_at": "2026-08-25T00:00:00+00:00"},
            {"book_id": 2, "setting_tags": ["现代"], "story_tone_tags": ["清甜校园"], "relationship_core_tags": ["相伴成长"], "tag_status": "confirmed", "created_at": "2026-08-24T00:00:00+00:00"},
        ],
        "reader_profiles": [{
            "user_id": "reader-1",
            "display_name": "读者",
            "personalization_enabled": True,
            "preference_weights": {
                "setting": {"现代": 2},
                "story_tone": {"温暖治愈": 5},
                "relationship_core": {"久别重逢": 4},
            },
            "preference_updated_at": "2026-08-25T00:00:00+00:00",
        }],
        "reading_history": [
            {"user_id": "reader-2", "book_id": 1, "active_seconds": 180, "open_count": 1, "completion_count": 1},
        ],
        "reader_favorites": [{"user_id": "reader-2", "book_id": 1}],
        "feedbacks": [],
        "recommendation_logs": [],
    }


class RecommendationServiceTests(unittest.TestCase):
    def test_authenticated_ranking_blends_explicit_and_learned_preferences(self):
        fake = FakeSupabase(database())
        prefs = UserPreferences(setting_tags=["现代"])
        with patch("app.services.recommendation_service.supabase", fake), patch(
            "app.services.personalization_service.supabase", fake
        ):
            result = get_recommendations(prefs, principal())
        self.assertEqual(result["results"][0]["book_id"], 1)
        log = fake.tables["recommendation_logs"][0]
        self.assertEqual(log["reader_user_id"], "reader-1")
        self.assertIn("light-personalization-v1", log["strategy_version"])

    def test_not_interested_book_is_excluded_for_that_reader(self):
        data = database()
        data["feedbacks"].append({
            "reader_user_id": "reader-1", "book_id": 1, "reason": "不感兴趣"
        })
        fake = FakeSupabase(data)
        prefs = UserPreferences(setting_tags=["现代"])
        with patch("app.services.recommendation_service.supabase", fake), patch(
            "app.services.personalization_service.supabase", fake
        ):
            result = get_recommendations(prefs, principal())
        self.assertEqual([item["book_id"] for item in result["results"]], [2])

    def test_anonymous_recommendation_keeps_explicit_tag_scoring(self):
        fake = FakeSupabase(database())
        prefs = UserPreferences(story_tone_tags=["清甜校园"])
        with patch("app.services.recommendation_service.supabase", fake):
            result = get_recommendations(prefs)
        self.assertEqual(result["results"][0]["book_id"], 2)
        self.assertIsNone(fake.tables["recommendation_logs"][0]["reader_user_id"])


if __name__ == "__main__":
    unittest.main()
