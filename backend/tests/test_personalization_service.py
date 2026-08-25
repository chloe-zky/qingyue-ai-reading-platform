import unittest
from unittest.mock import patch

from app.services.personalization_service import (
    adjust_book_preferences,
    get_reader_personalization,
)
from app.utils.reader_auth import ReaderPrincipal
from test_reader_service import FakeSupabase


def principal():
    return ReaderPrincipal(
        user_id="reader-1", email="reader@example.com", display_name="读者"
    )


def database(enabled=True):
    return {
        "reader_profiles": [{
            "user_id": "reader-1",
            "display_name": "读者",
            "personalization_enabled": enabled,
            "preference_weights": {
                "setting": {}, "story_tone": {}, "relationship_core": {},
            },
            "preference_updated_at": "2026-08-25T00:00:00+00:00",
        }],
        "book_ai_tags": [{
            "book_id": 1,
            "setting_tags": ["现代"],
            "story_tone_tags": ["温暖治愈"],
            "relationship_core_tags": ["久别重逢"],
            "tag_status": "confirmed",
        }],
    }


class PersonalizationServiceTests(unittest.TestCase):
    def test_adjusts_only_controlled_book_tags(self):
        fake = FakeSupabase(database())
        with patch("app.services.personalization_service.supabase", fake):
            weights = adjust_book_preferences(principal(), 1, 3)
        self.assertAlmostEqual(weights["setting"]["现代"], 3, places=6)
        self.assertAlmostEqual(weights["story_tone"]["温暖治愈"], 3, places=6)
        self.assertAlmostEqual(weights["relationship_core"]["久别重逢"], 3, places=6)

    def test_style_feedback_only_changes_story_tone(self):
        fake = FakeSupabase(database())
        with patch("app.services.personalization_service.supabase", fake):
            weights = adjust_book_preferences(
                principal(), 1, -3, ("story_tone",)
            )
        self.assertEqual(weights["setting"], {})
        self.assertAlmostEqual(weights["story_tone"]["温暖治愈"], -3, places=6)

    def test_disabled_personalization_does_not_learn(self):
        fake = FakeSupabase(database(enabled=False))
        with patch("app.services.personalization_service.supabase", fake):
            weights = adjust_book_preferences(principal(), 1, 3)
            state = get_reader_personalization(principal())
        self.assertEqual(weights["setting"], {})
        self.assertFalse(state["enabled"])


if __name__ == "__main__":
    unittest.main()
