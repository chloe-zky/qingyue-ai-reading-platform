import copy
import unittest
from collections import Counter
from types import SimpleNamespace
from unittest.mock import patch

from app.schemas.recommendation import UserPreferences
from app.services.recommendation_service import (
    clear_recommendation_cache,
    get_recommendations,
    prepare_recommendations,
    write_recommendation_log,
)
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


class RecommendationFakeSupabase(FakeSupabase):
    def execute_rpc(self, name, params):
        if name != "get_recommendation_context":
            return super().execute_rpc(name, params)
        strategy_row = self.tables["editorial_strategy_versions"][0]
        settings = strategy_row["settings"]
        weights = settings["weights"]
        tags_by_book = {
            row["book_id"]: row for row in self.tables["book_ai_tags"]
            if row.get("tag_status") == "confirmed"
        }
        candidates = []
        for book in self.tables["books"]:
            tag = tags_by_book.get(book["id"])
            if book.get("status") != "active" or not tag:
                continue
            quality = 1.0 if book["id"] == 1 else 0.0
            candidates.append({
                **copy.deepcopy(book),
                **copy.deepcopy(tag),
                "tag_created_at": tag.get("created_at"),
                "quality_score": quality,
            })
        reader_id = params.get("p_reader_user_id")
        profile = next(({
            "personalization_enabled": row.get("personalization_enabled", True),
            "preference_weights": row.get("preference_weights", {}),
            "preference_updated_at": row.get("preference_updated_at"),
        } for row in self.tables["reader_profiles"] if row["user_id"] == reader_id), None)
        feedbacks = [
            {"book_id": row["book_id"], "reason": row["reason"]}
            for row in self.tables["feedbacks"]
            if row.get("reader_user_id") == reader_id
        ]
        return SimpleNamespace(data={
            "strategy": {
                "version": f"editorial-v{strategy_row['version_no']}",
                "setting_weight": weights["setting"],
                "story_tone_weight": weights["story_tone"],
                "relationship_core_weight": weights["relationship_core"],
                "max_score": settings["max_score"],
                "result_limit": settings["result_limit"],
                "cold_start_limit": settings["cold_start"]["limit"],
            },
            "candidates": candidates,
            "reader_profile": profile,
            "feedbacks": feedbacks,
        })


class CountingFakeSupabase(RecommendationFakeSupabase):
    def __init__(self, tables):
        super().__init__(tables)
        self.table_exec_counts = Counter()
        self.rpc_exec_counts = Counter()

    def execute(self, query):
        self.table_exec_counts[query.table_name] += 1
        return super().execute(query)

    def execute_rpc(self, name, params):
        self.rpc_exec_counts[name] += 1
        return super().execute_rpc(name, params)


class RecommendationServiceTests(unittest.TestCase):
    def setUp(self):
        clear_recommendation_cache()

    def tearDown(self):
        clear_recommendation_cache()

    def test_authenticated_ranking_blends_explicit_and_learned_preferences(self):
        fake = RecommendationFakeSupabase(database())
        prefs = UserPreferences(setting_tags=["现代"])
        with patch("app.services.recommendation_service.supabase", fake), patch(
            "app.services.personalization_service.supabase", fake
        ):
            result = get_recommendations(prefs, principal())
        self.assertEqual(result["results"][0]["book_id"], 1)
        self.assertNotIn("full_content", result["results"][0])
        log = fake.tables["recommendation_logs"][0]
        self.assertEqual(log["reader_user_id"], "reader-1")
        self.assertIn("light-personalization-v1", log["strategy_version"])

    def test_not_interested_book_is_excluded_for_that_reader(self):
        data = database()
        data["feedbacks"].append({
            "reader_user_id": "reader-1", "book_id": 1, "reason": "不感兴趣"
        })
        fake = RecommendationFakeSupabase(data)
        prefs = UserPreferences(setting_tags=["现代"])
        with patch("app.services.recommendation_service.supabase", fake), patch(
            "app.services.personalization_service.supabase", fake
        ):
            result = get_recommendations(prefs, principal())
        self.assertEqual([item["book_id"] for item in result["results"]], [2])

    def test_easter_egg_book_is_never_recommended_but_remains_active(self):
        data = database()
        data["books"].append({
            "id": 27,
            "title": "去似朝云无觅处",
            "author": "绿亦歌",
            "intro": "彩蛋篇",
            "status": "active",
            "created_at": "2026-08-26T00:00:00+00:00",
        })
        data["book_ai_tags"].append({
            "book_id": 27,
            "setting_tags": ["现代"],
            "story_tone_tags": ["遗憾青春"],
            "relationship_core_tags": ["命运拉扯"],
            "tag_status": "confirmed",
            "created_at": "2026-08-26T00:00:00+00:00",
        })
        fake = RecommendationFakeSupabase(data)
        with patch("app.services.recommendation_service.supabase", fake):
            exact = get_recommendations(UserPreferences(setting_tags=["现代"]))
            cold_start = get_recommendations(UserPreferences())

        self.assertEqual(data["books"][-1]["status"], "active")
        self.assertNotIn(27, {item["book_id"] for item in exact["results"]})
        self.assertNotIn(27, {item["book_id"] for item in cold_start["results"]})

    def test_anonymous_recommendation_keeps_explicit_tag_scoring(self):
        fake = RecommendationFakeSupabase(database())
        prefs = UserPreferences(story_tone_tags=["清甜校园"])
        with patch("app.services.recommendation_service.supabase", fake):
            result = get_recommendations(prefs)
        self.assertEqual(result["results"][0]["book_id"], 2)
        self.assertIsNone(fake.tables["recommendation_logs"][0]["reader_user_id"])

    def test_anonymous_combined_context_is_reused_within_ttl(self):
        fake = CountingFakeSupabase(database())
        prefs = UserPreferences(setting_tags=["现代"])
        with patch("app.services.recommendation_service.supabase", fake):
            get_recommendations(prefs)
            get_recommendations(prefs)

        self.assertEqual(fake.rpc_exec_counts["get_recommendation_context"], 1)
        self.assertEqual(fake.table_exec_counts["books"], 0)
        self.assertEqual(fake.table_exec_counts["book_ai_tags"], 0)

    def test_authenticated_request_uses_one_combined_context_rpc(self):
        fake = CountingFakeSupabase(database())
        with patch("app.services.recommendation_service.supabase", fake):
            get_recommendations(UserPreferences(setting_tags=["现代"]), principal())
        self.assertEqual(fake.rpc_exec_counts["get_recommendation_context"], 1)
        self.assertEqual(fake.table_exec_counts["reader_profiles"], 0)
        self.assertEqual(fake.table_exec_counts["feedbacks"], 0)

    def test_selection_without_any_match_falls_back_to_closest_reads(self):
        fake = RecommendationFakeSupabase(database())
        # 民国 is a published term no active book carries.
        prefs = UserPreferences(setting_tags=["民国"])
        with patch("app.services.recommendation_service.supabase", fake):
            result = get_recommendations(prefs)

        self.assertTrue(result["results"])
        self.assertEqual(result["match_type"], "closest")
        self.assertTrue(result["notice"])
        self.assertEqual(
            {item["match_type"] for item in result["results"]}, {"closest"}
        )
        self.assertTrue(all(item["score"] == 0 for item in result["results"]))

    def test_exact_match_is_reported_without_a_notice(self):
        # A full page of exact matches: nothing is topped up, so no notice.
        data = database()
        data["editorial_strategy_versions"][0]["settings"]["result_limit"] = 1
        fake = RecommendationFakeSupabase(data)
        prefs = UserPreferences(story_tone_tags=["清甜校园"])
        with patch("app.services.recommendation_service.supabase", fake):
            result = get_recommendations(prefs)

        self.assertEqual(result["match_type"], "exact")
        self.assertEqual(result["notice"], "")
        self.assertEqual(result["results"][0]["book_id"], 2)
        self.assertEqual(result["results"][0]["match_type"], "exact")

    def test_all_exact_matches_are_returned_beyond_strategy_result_limit(self):
        data = database()
        for book_id in range(3, 9):
            data["books"].append({
                "id": book_id,
                "title": f"现代故事{book_id}",
                "author": f"作者{book_id}",
                "intro": "",
                "status": "active",
                "created_at": f"2026-08-{20 + book_id:02d}T00:00:00+00:00",
            })
            data["book_ai_tags"].append({
                "book_id": book_id,
                "setting_tags": ["现代"],
                "story_tone_tags": ["温暖治愈"],
                "relationship_core_tags": ["久别重逢"],
                "tag_status": "confirmed",
                "created_at": f"2026-08-{20 + book_id:02d}T00:00:00+00:00",
            })
        fake = RecommendationFakeSupabase(data)
        with patch("app.services.recommendation_service.supabase", fake):
            result = get_recommendations(UserPreferences(setting_tags=["现代"]))

        self.assertEqual(len(result["results"]), 8)
        self.assertEqual(result["match_type"], "exact")

    def test_partial_match_keeps_exact_first_and_marks_the_response_mixed(self):
        fake = RecommendationFakeSupabase(database())
        prefs = UserPreferences(story_tone_tags=["温暖治愈"])
        with patch("app.services.recommendation_service.supabase", fake):
            result = get_recommendations(prefs)

        self.assertEqual(result["match_type"], "mixed")
        self.assertEqual(result["results"][0]["book_id"], 1)
        self.assertEqual(result["results"][0]["match_type"], "exact")
        self.assertEqual(result["results"][1]["match_type"], "closest")

    def test_closest_fallback_never_leaks_inactive_or_unconfirmed_books(self):
        data = database()
        data["books"].extend([
            {"id": 3, "title": "下架", "author": "甲", "intro": "", "status": "inactive", "created_at": "2026-08-26T00:00:00+00:00"},
            {"id": 4, "title": "待审", "author": "乙", "intro": "", "status": "active", "created_at": "2026-08-27T00:00:00+00:00"},
        ])
        data["book_ai_tags"].extend([
            {"book_id": 3, "setting_tags": ["现代"], "story_tone_tags": [], "relationship_core_tags": [], "tag_status": "confirmed", "created_at": "2026-08-26T00:00:00+00:00"},
            {"book_id": 4, "setting_tags": ["现代"], "story_tone_tags": [], "relationship_core_tags": [], "tag_status": "draft", "created_at": "2026-08-27T00:00:00+00:00"},
        ])
        fake = RecommendationFakeSupabase(data)
        prefs = UserPreferences(setting_tags=["民国"])
        with patch("app.services.recommendation_service.supabase", fake):
            result = get_recommendations(prefs)

        returned = {item["book_id"] for item in result["results"]}
        self.assertEqual(returned, {1, 2})

    def test_closest_fallback_respects_not_interested_feedback(self):
        data = database()
        data["feedbacks"].append({
            "reader_user_id": "reader-1", "book_id": 1, "reason": "不感兴趣"
        })
        fake = RecommendationFakeSupabase(data)
        prefs = UserPreferences(setting_tags=["民国"])
        with patch("app.services.recommendation_service.supabase", fake), patch(
            "app.services.personalization_service.supabase", fake
        ):
            result = get_recommendations(prefs, principal())

        self.assertNotIn(1, {item["book_id"] for item in result["results"]})

    def test_skip_all_steps_with_an_unmatchable_profile_still_returns_reads(self):
        # 跳过三步 → 无显式选择；学习到的偏好又落在当前没有作品带的标签上。
        # 这条路以前会返回空白页。
        data = database()
        data["reader_profiles"][0]["preference_weights"] = {
            "setting": {"民国": 5},
            "story_tone": {"浓情曲折": 4},
            "relationship_core": {"命运拉扯": 3},
        }
        fake = RecommendationFakeSupabase(data)
        with patch("app.services.recommendation_service.supabase", fake), patch(
            "app.services.personalization_service.supabase", fake
        ):
            result = get_recommendations(UserPreferences(), principal())

        self.assertTrue(result["results"])
        self.assertEqual(result["match_type"], "cold_start")

    def test_cold_start_response_is_marked_and_carries_no_notice(self):
        data = database()
        data["reader_profiles"][0]["preference_weights"] = {
            "setting": {}, "story_tone": {}, "relationship_core": {},
        }
        fake = RecommendationFakeSupabase(data)
        with patch("app.services.recommendation_service.supabase", fake):
            result = get_recommendations(UserPreferences())

        self.assertEqual(result["match_type"], "cold_start")
        self.assertEqual(result["notice"], "")
        self.assertTrue(result["results"])

    def test_skipping_returns_the_entire_eligible_catalog(self):
        data = database()
        for book_id in range(3, 13):
            data["books"].append({
                "id": book_id,
                "title": f"作品{book_id}",
                "author": f"作者{book_id}",
                "intro": "",
                "status": "active",
                "created_at": f"2026-08-{book_id:02d}T00:00:00+00:00",
            })
            data["book_ai_tags"].append({
                "book_id": book_id,
                "setting_tags": ["现代"],
                "story_tone_tags": ["温暖治愈"],
                "relationship_core_tags": ["久别重逢"],
                "tag_status": "confirmed",
                "created_at": f"2026-08-{book_id:02d}T00:00:00+00:00",
            })
        fake = RecommendationFakeSupabase(data)
        with patch("app.services.recommendation_service.supabase", fake):
            result = get_recommendations(UserPreferences())

        self.assertEqual(len(result["results"]), 12)
        self.assertEqual(result["match_type"], "cold_start")

    def test_prepare_defers_log_write_until_explicit_background_step(self):
        fake = RecommendationFakeSupabase(database())
        prefs = UserPreferences(story_tone_tags=["清甜校园"])
        with patch("app.services.recommendation_service.supabase", fake):
            result, log_payload = prepare_recommendations(prefs)
            self.assertEqual(fake.tables["recommendation_logs"], [])
            write_recommendation_log(log_payload)

        self.assertEqual(result["results"][0]["book_id"], 2)
        self.assertEqual(len(fake.tables["recommendation_logs"]), 1)


if __name__ == "__main__":
    unittest.main()
