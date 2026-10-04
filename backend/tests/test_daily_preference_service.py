import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from app.schemas.recommendation import UserPreferences
from app.services.daily_preference_service import (
    InvalidDailyPreferenceError,
    VocabularyUnavailableError,
    business_date,
    get_today_selections,
    save_today_selections,
    selections_to_preferences,
)
from app.utils.reader_auth import ReaderPrincipal
from test_reader_service import FakeSupabase


VOCABULARY = {
    "version_no": 1,
    "setting_tags": ["现代", "古风", "民国"],
    "story_tone_tags": ["清甜校园", "温暖治愈"],
    "relationship_core_tags": ["久别重逢", "相伴成长"],
    "aesthetic_tags": [],
    "risk_tags": [],
}


def principal(user_id="reader-1"):
    return ReaderPrincipal(
        user_id=user_id, email=f"{user_id}@example.com", display_name="读者"
    )


def tables(rows=None):
    return {"reader_daily_preferences": list(rows or [])}


def utc(text):
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


class BusinessDateTests(unittest.TestCase):
    def test_beijing_late_evening_still_belongs_to_that_day(self):
        # 2026-08-31 23:59 Beijing == 15:59 UTC on the same date.
        self.assertEqual(
            business_date(utc("2026-08-31T15:59:00")).isoformat(), "2026-08-31"
        )

    def test_beijing_midnight_starts_the_next_day(self):
        # 2026-09-01 00:00 Beijing == 2026-08-31 16:00 UTC.
        self.assertEqual(
            business_date(utc("2026-08-31T16:00:00")).isoformat(), "2026-09-01"
        )

    def test_utc_date_alone_would_be_wrong_after_beijing_midnight(self):
        moment = utc("2026-08-31T16:30:00")
        self.assertNotEqual(business_date(moment), moment.date())

    def test_naive_input_is_read_as_utc(self):
        self.assertEqual(
            business_date(datetime(2026, 8, 31, 16, 0)).isoformat(), "2026-09-01"
        )


class DailyPreferenceServiceTests(unittest.TestCase):
    def setUp(self):
        self.vocabulary_patch = patch(
            "app.services.daily_preference_service.get_valid_vocabularies",
            return_value=dict(VOCABULARY),
        )
        self.vocabulary_patch.start()
        self.addCleanup(self.vocabulary_patch.stop)

    def test_missing_row_means_the_reader_has_not_chosen_today(self):
        fake = FakeSupabase(tables())
        with patch("app.services.daily_preference_service.supabase", fake):
            self.assertIsNone(
                get_today_selections(principal(), utc("2026-08-31T02:00:00"))
            )

    def test_save_then_read_returns_the_same_selections(self):
        fake = FakeSupabase(tables())
        prefs = UserPreferences(setting_tags=["现代"], story_tone_tags=["温暖治愈"])
        now = utc("2026-08-31T02:00:00")
        with patch("app.services.daily_preference_service.supabase", fake):
            saved = save_today_selections(principal(), prefs, now)
            stored = get_today_selections(principal(), now)

        self.assertEqual(saved["preference_date"], "2026-08-31")
        self.assertEqual(stored["selections"]["setting_tags"], ["现代"])
        self.assertEqual(stored["selections"]["story_tone_tags"], ["温暖治愈"])
        self.assertEqual(stored["selections"]["relationship_core_tags"], [])

    def test_repeated_save_on_the_same_day_upserts_one_row(self):
        fake = FakeSupabase(tables())
        now = utc("2026-08-31T02:00:00")
        with patch("app.services.daily_preference_service.supabase", fake):
            save_today_selections(principal(), UserPreferences(setting_tags=["现代"]), now)
            save_today_selections(principal(), UserPreferences(setting_tags=["古风"]), now)
            stored = get_today_selections(principal(), now)

        rows = fake.tables["reader_daily_preferences"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(stored["selections"]["setting_tags"], ["古风"])

    def test_next_business_day_has_no_state_even_with_yesterdays_row(self):
        fake = FakeSupabase(tables())
        with patch("app.services.daily_preference_service.supabase", fake):
            save_today_selections(
                principal(),
                UserPreferences(setting_tags=["现代"]),
                utc("2026-08-31T15:59:00"),  # 23:59 Beijing
            )
            tomorrow = get_today_selections(
                principal(), utc("2026-08-31T16:00:00")  # 00:00 Beijing, next day
            )
        self.assertIsNone(tomorrow)
        self.assertEqual(len(fake.tables["reader_daily_preferences"]), 1)

    def test_one_reader_cannot_read_another_readers_day(self):
        fake = FakeSupabase(tables())
        now = utc("2026-08-31T02:00:00")
        with patch("app.services.daily_preference_service.supabase", fake):
            save_today_selections(
                principal("reader-1"), UserPreferences(setting_tags=["现代"]), now
            )
            other = get_today_selections(principal("reader-2"), now)
        self.assertIsNone(other)

    def test_one_reader_cannot_overwrite_another_readers_day(self):
        fake = FakeSupabase(tables())
        now = utc("2026-08-31T02:00:00")
        with patch("app.services.daily_preference_service.supabase", fake):
            save_today_selections(
                principal("reader-1"), UserPreferences(setting_tags=["现代"]), now
            )
            save_today_selections(
                principal("reader-2"), UserPreferences(setting_tags=["古风"]), now
            )
            first = get_today_selections(principal("reader-1"), now)

        self.assertEqual(first["selections"]["setting_tags"], ["现代"])
        self.assertEqual(len(fake.tables["reader_daily_preferences"]), 2)

    def test_unpublished_tag_is_rejected_and_nothing_is_written(self):
        fake = FakeSupabase(tables())
        with patch("app.services.daily_preference_service.supabase", fake):
            with self.assertRaises(InvalidDailyPreferenceError):
                save_today_selections(
                    principal(),
                    UserPreferences(setting_tags=["未来废土"]),
                    utc("2026-08-31T02:00:00"),
                )
        self.assertEqual(fake.tables["reader_daily_preferences"], [])

    def test_empty_selection_is_a_valid_skip(self):
        fake = FakeSupabase(tables())
        now = utc("2026-08-31T02:00:00")
        with patch("app.services.daily_preference_service.supabase", fake):
            saved = save_today_selections(principal(), UserPreferences(), now)
        self.assertEqual(saved["selections"], {
            "setting_tags": [], "story_tone_tags": [], "relationship_core_tags": [],
        })

    def test_unavailable_vocabulary_does_not_let_free_text_through(self):
        empty = {key: [] for key in VOCABULARY}
        fake = FakeSupabase(tables())
        with patch("app.services.daily_preference_service.supabase", fake), patch(
            "app.services.daily_preference_service.get_valid_vocabularies",
            return_value=empty,
        ):
            with self.assertRaises(VocabularyUnavailableError):
                save_today_selections(
                    principal(),
                    UserPreferences(setting_tags=["现代"]),
                    utc("2026-08-31T02:00:00"),
                )
        self.assertEqual(fake.tables["reader_daily_preferences"], [])

    def test_selections_round_trip_into_recommendation_preferences(self):
        prefs = selections_to_preferences({
            "setting_tags": ["现代"],
            "story_tone_tags": [],
            "relationship_core_tags": ["久别重逢"],
        })
        self.assertEqual(prefs.setting_tags, ["现代"])
        self.assertEqual(prefs.relationship_core_tags, ["久别重逢"])
        self.assertEqual(selections_to_preferences(None).setting_tags, [])


if __name__ == "__main__":
    unittest.main()
