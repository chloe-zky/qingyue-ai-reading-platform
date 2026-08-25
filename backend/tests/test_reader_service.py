import copy
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from app.services.reader_service import (
    ReaderBookNotFoundError,
    add_favorite,
    get_reader_profile,
    list_favorites,
    list_reading_history,
    remove_favorite,
    save_reading_progress,
)
from app.utils.reader_auth import ReaderPrincipal


class FakeQuery:
    def __init__(self, database, table_name):
        self.database = database
        self.table_name = table_name
        self.operation = "select"
        self.payload = None
        self.filters = []
        self.max_rows = None
        self.order_by = None
        self.desc = False
        self.start_row = None
        self.end_row = None

    def select(self, _columns="*"):
        self.operation = "select"
        return self

    def eq(self, key, value):
        self.filters.append(("eq", key, value))
        return self

    def in_(self, key, values):
        self.filters.append(("in", key, values))
        return self

    def limit(self, value):
        self.max_rows = value
        return self

    def order(self, key, desc=False):
        self.order_by = key
        self.desc = desc
        return self

    def range(self, start, end):
        self.start_row = start
        self.end_row = end
        return self

    def insert(self, payload):
        self.operation = "insert"
        self.payload = copy.deepcopy(payload)
        return self

    def upsert(self, payload, on_conflict=None):
        self.operation = "upsert"
        self.payload = copy.deepcopy(payload)
        self.on_conflict = (on_conflict or "").split(",")
        return self

    def update(self, payload):
        self.operation = "update"
        self.payload = copy.deepcopy(payload)
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def execute(self):
        return self.database.execute(self)


class FakeSupabase:
    def __init__(self, tables):
        self.tables = copy.deepcopy(tables)

    def table(self, name):
        return FakeQuery(self, name)

    def rpc(self, name, params):
        return FakeRpc(self, name, params)

    def execute_rpc(self, name, params):
        if name == "set_reader_favorite_atomic":
            rows = self.tables["reader_favorites"]
            existing = next((row for row in rows if row["user_id"] == params["p_user_id"] and row["book_id"] == params["p_book_id"]), None)
            if params["p_is_favorite"] and not existing:
                rows.append({"user_id": params["p_user_id"], "book_id": params["p_book_id"], "created_at": "2026-08-25T01:00:00+00:00"})
            if not params["p_is_favorite"] and existing:
                rows.remove(existing)
            return SimpleNamespace(data={"book_id": params["p_book_id"], "is_favorite": params["p_is_favorite"], "changed": bool(existing) != params["p_is_favorite"]})
        if name == "record_reader_progress_atomic":
            rows = self.tables["reading_history"]
            row = next((item for item in rows if item["user_id"] == params["p_user_id"] and item["book_id"] == params["p_book_id"]), None)
            if row is None:
                row = {"user_id": params["p_user_id"], "book_id": params["p_book_id"], "progress_percent": 0, "active_seconds": 0, "open_count": 0, "completion_count": 0, "completed_at": None}
                rows.append(row)
                distinct_open = params["p_opened"]
            else:
                distinct_open = False
            row["progress_percent"] = max(row["progress_percent"], params["p_progress_percent"])
            row["active_seconds"] += params["p_active_seconds_delta"]
            row["open_count"] += int(distinct_open)
            if row["completed_at"] is None and row["progress_percent"] >= 85:
                row["completed_at"] = "2026-08-25T01:00:00+00:00"
                row["completion_count"] += 1
            row["last_read_at"] = "2026-08-25T01:00:00+00:00"
            return SimpleNamespace(data=copy.deepcopy(row))
        if name == "record_reader_feedback_atomic":
            rows = self.tables["feedbacks"]
            row = next((item for item in rows if item.get("reader_user_id") == params["p_user_id"] and item["request_id"] == params["p_request_id"] and item["book_id"] == params["p_book_id"]), None)
            if row is None:
                row = {
                    "id": len(rows) + 1,
                    "reader_user_id": params["p_user_id"],
                    "request_id": params["p_request_id"],
                    "book_id": params["p_book_id"],
                    "book_title": params["p_book_title"],
                    "reason": params["p_reason"],
                    "user_prefs": params["p_user_prefs"],
                    "feedback_note": params["p_feedback_note"],
                }
                rows.append(row)
            return SimpleNamespace(data=copy.deepcopy(row))
        if name == "get_book_quality_scores":
            scores = {}
            for row in self.tables.get("reading_history", []):
                scores[row["book_id"]] = scores.get(row["book_id"], 0) + 2 * row.get("completion_count", 0) + min(row.get("active_seconds", 0) / 300, 1) + min(row.get("open_count", 0), 3) * 0.2
            for row in self.tables.get("reader_favorites", []):
                scores[row["book_id"]] = scores.get(row["book_id"], 0) + 3
            maximum = max(scores.values(), default=0)
            return SimpleNamespace(data=[{"book_id": book_id, "quality_score": scores.get(book_id, 0) / maximum if maximum else 0} for book_id in params["p_book_ids"]])
        if name == "_apply_book_preference_signal":
            profile = next(row for row in self.tables["reader_profiles"] if row["user_id"] == params["p_user_id"])
            if not profile.get("personalization_enabled", True):
                return SimpleNamespace(data=None)
            tags = next((row for row in self.tables["book_ai_tags"] if row["book_id"] == params["p_book_id"] and row["tag_status"] == "confirmed"), None)
            dimensions = params["p_dimensions"] or ["setting", "story_tone", "relationship_core"]
            for dimension in dimensions:
                column = {"setting": "setting_tags", "story_tone": "story_tone_tags", "relationship_core": "relationship_core_tags"}[dimension]
                values = profile["preference_weights"][dimension]
                for tag in (tags or {}).get(column, []):
                    values[tag] = values.get(tag, 0) + params["p_delta"]
            profile["preference_updated_at"] = datetime.now(timezone.utc).isoformat()
            return SimpleNamespace(data=None)
        raise AssertionError(f"unsupported rpc: {name}")

    def execute(self, query):
        rows = self.tables[query.table_name]
        matches = rows
        for operation, key, value in query.filters:
            if operation == "eq":
                matches = [row for row in matches if row.get(key) == value]
            elif operation == "in":
                matches = [row for row in matches if row.get(key) in value]
        if query.order_by:
            matches = sorted(
                matches,
                key=lambda row: row.get(query.order_by) or "",
                reverse=query.desc,
            )
        if query.start_row is not None:
            matches = matches[query.start_row : query.end_row + 1]
        if query.max_rows is not None:
            matches = matches[: query.max_rows]

        if query.operation == "select":
            return SimpleNamespace(data=copy.deepcopy(matches))
        if query.operation == "insert":
            result = copy.deepcopy(query.payload)
            result.setdefault("id", len(rows) + 1)
            rows.append(result)
            return SimpleNamespace(data=[copy.deepcopy(result)])
        if query.operation == "upsert":
            existing = next(
                (
                    row
                    for row in rows
                    if all(row.get(key) == query.payload.get(key) for key in query.on_conflict)
                ),
                None,
            )
            if existing:
                existing.update(copy.deepcopy(query.payload))
                result = existing
            else:
                result = copy.deepcopy(query.payload)
                if query.table_name == "reader_profiles":
                    result.setdefault("created_at", "2026-08-25T00:00:00+00:00")
                    result.setdefault("updated_at", result["created_at"])
                rows.append(result)
            return SimpleNamespace(data=[copy.deepcopy(result)])
        if query.operation == "update":
            for row in matches:
                row.update(copy.deepcopy(query.payload))
            return SimpleNamespace(data=copy.deepcopy(matches))
        if query.operation == "delete":
            self.tables[query.table_name] = [row for row in rows if row not in matches]
            return SimpleNamespace(data=copy.deepcopy(matches))
        raise AssertionError(f"unsupported operation: {query.operation}")


class FakeRpc:
    def __init__(self, database, name, params):
        self.database = database
        self.name = name
        self.params = copy.deepcopy(params)

    def execute(self):
        return self.database.execute_rpc(self.name, self.params)


def principal():
    return ReaderPrincipal(
        user_id="reader-1", email="chloe@example.com", display_name="Chloe"
    )


def tables():
    return {
        "reader_profiles": [
            {
                "user_id": "reader-1",
                "display_name": "Chloe",
                "created_at": "2026-08-24T00:00:00+00:00",
                "updated_at": "2026-08-24T00:00:00+00:00",
                "personalization_enabled": True,
            }
        ],
        "reader_favorites": [],
        "reading_history": [],
        "books": [
            {
                "id": 1,
                "title": "春日",
                "author": "林夏",
                "intro": "重逢",
                "full_content": "春天又回到了河岸。",
                "status": "active",
                "cover_image_url": "",
            },
            {"id": 2, "title": "草稿", "author": "某人", "status": "pending_review"},
        ],
    }


class ReaderServiceTests(unittest.TestCase):
    def test_profile_reports_real_counts(self):
        data = tables()
        data["reader_favorites"].append(
            {"user_id": "reader-1", "book_id": 1, "created_at": "2026-08-25T01:00:00+00:00"}
        )
        data["reading_history"].append(
            {"user_id": "reader-1", "book_id": 1, "progress_percent": 25}
        )
        with patch("app.services.reader_service.supabase", FakeSupabase(data)):
            result = get_reader_profile(principal())
        self.assertEqual(result["display_name"], "Chloe")
        self.assertEqual(result["favorites_count"], 1)
        self.assertEqual(result["history_count"], 1)
        self.assertGreaterEqual(result["reader_days"], 1)
        self.assertTrue(result["personalization_enabled"])

    def test_favorite_round_trip_only_allows_active_books(self):
        fake = FakeSupabase(tables())
        with patch("app.services.reader_service.supabase", fake):
            self.assertTrue(add_favorite(principal(), 1)["is_favorite"])
            favorite = list_favorites(principal())[0]
            self.assertEqual(favorite["title"], "春日")
            self.assertEqual(favorite["full_content"], "春天又回到了河岸。")
            self.assertFalse(remove_favorite(principal(), 1)["is_favorite"])
            self.assertEqual(list_favorites(principal()), [])
            with self.assertRaises(ReaderBookNotFoundError):
                add_favorite(principal(), 2)

    def test_reading_progress_is_saved_and_returned(self):
        fake = FakeSupabase(tables())
        with patch("app.services.reader_service.supabase", fake):
            result = save_reading_progress(
                principal(), 1, 72, active_seconds_delta=35, opened=True,
                request_id="request-1",
            )
            history = list_reading_history(principal())
        self.assertEqual(result["progress_percent"], 72)
        self.assertEqual(history[0]["book_id"], 1)
        self.assertEqual(history[0]["progress_percent"], 72)
        self.assertEqual(history[0]["full_content"], "春天又回到了河岸。")
        self.assertEqual(result["active_seconds"], 35)
        self.assertEqual(result["open_count"], 1)
        self.assertEqual(result["completion_count"], 0)

    def test_progress_aggregation_does_not_double_apply_completion_signal(self):
        fake = FakeSupabase(tables())
        with patch("app.services.reader_service.supabase", fake):
            first = save_reading_progress(
                principal(), 1, 90, active_seconds_delta=40, opened=True
            )
            second = save_reading_progress(
                principal(), 1, 95, active_seconds_delta=20, opened=True
            )
        self.assertEqual(first["completion_count"], 1)
        self.assertEqual(second["completion_count"], 1)
        self.assertEqual(second["open_count"], 1)


if __name__ == "__main__":
    unittest.main()
