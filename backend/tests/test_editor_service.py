import copy
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.schemas.editor import ApproveArticleRequest
from app.services.editor_service import (
    SubmissionStateConflictError,
    approve_submission,
    reject_submission,
    request_submission_revision,
)


class FakeQuery:
    def __init__(self, database, table_name, operation="select", payload=None):
        self.database = database
        self.table_name = table_name
        self.operation = operation
        self.payload = payload
        self.filters = []

    def select(self, _columns="*"):
        self.operation = "select"
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def upsert(self, payload, on_conflict=None):
        self.operation = "upsert"
        self.payload = copy.deepcopy(payload)
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
    def __init__(self, books, tags, fail_book_update=False):
        self.rows = {
            "books": copy.deepcopy(books),
            "book_ai_tags": copy.deepcopy(tags),
        }
        self.fail_book_update = fail_book_update

    def table(self, table_name):
        return FakeQuery(self, table_name)

    def execute(self, query):
        rows = self.rows[query.table_name]
        matches = [
            row
            for row in rows
            if all(row.get(key) == value for key, value in query.filters)
        ]

        if query.operation == "select":
            return SimpleNamespace(data=copy.deepcopy(matches))

        if query.operation == "upsert":
            book_id = query.payload["book_id"]
            existing = next((row for row in rows if row.get("book_id") == book_id), None)
            if existing:
                existing.clear()
                existing.update(copy.deepcopy(query.payload))
            else:
                rows.append(copy.deepcopy(query.payload))
            return SimpleNamespace(data=[copy.deepcopy(query.payload)])

        if query.operation == "update":
            if query.table_name == "books" and self.fail_book_update:
                raise RuntimeError("simulated publish failure")
            for row in matches:
                row.update(copy.deepcopy(query.payload))
            return SimpleNamespace(data=copy.deepcopy(matches))

        if query.operation == "delete":
            self.rows[query.table_name] = [row for row in rows if row not in matches]
            return SimpleNamespace(data=copy.deepcopy(matches))

        raise AssertionError(f"unsupported operation: {query.operation}")


def approval_request():
    return ApproveArticleRequest(
        setting_tags=["现代"],
        story_tone_tags=["温暖治愈"],
        relationship_core_tags=["相伴成长"],
        aesthetic_tags=["克制叙事"],
        recommend_reason="适合轻阅读",
    )


class ApproveSubmissionTests(unittest.TestCase):
    def test_approves_pending_submission(self):
        fake = FakeSupabase(
            books=[{"id": 8, "status": "pending_review"}],
            tags=[{"book_id": 8, "tag_status": "draft", "tag_source": "ai"}],
        )

        with patch("app.services.editor_service.supabase", fake):
            result = approve_submission(8, approval_request())

        self.assertEqual(fake.rows["books"][0]["status"], "active")
        self.assertEqual(fake.rows["book_ai_tags"][0]["tag_status"], "confirmed")
        self.assertEqual(result["article_status"], "active")

    def test_rejects_duplicate_approval(self):
        fake = FakeSupabase(
            books=[{"id": 8, "status": "active"}],
            tags=[{"book_id": 8, "tag_status": "confirmed"}],
        )

        with patch("app.services.editor_service.supabase", fake):
            with self.assertRaises(SubmissionStateConflictError):
                approve_submission(8, approval_request())

    def test_restores_draft_tags_when_publish_fails(self):
        original_tags = {
            "book_id": 8,
            "tag_status": "draft",
            "tag_source": "ai",
            "setting_tags": ["旧标签"],
        }
        fake = FakeSupabase(
            books=[{"id": 8, "status": "pending_review"}],
            tags=[original_tags],
            fail_book_update=True,
        )

        with patch("app.services.editor_service.supabase", fake):
            with self.assertRaisesRegex(RuntimeError, "标签状态已自动恢复"):
                approve_submission(8, approval_request())

        self.assertEqual(fake.rows["book_ai_tags"][0], original_tags)
        self.assertEqual(fake.rows["books"][0]["status"], "pending_review")


class EditorDecisionTests(unittest.TestCase):
    def test_rejects_pending_submission_with_feedback(self):
        fake = FakeSupabase(
            books=[{"id": 8, "status": "pending_review"}],
            tags=[],
        )

        with patch("app.services.editor_service.supabase", fake):
            result = reject_submission(8, "  题材与刊物方向不符。  ")

        book = fake.rows["books"][0]
        self.assertEqual(book["status"], "rejected")
        self.assertEqual(book["editor_feedback"], "题材与刊物方向不符。")
        self.assertTrue(book["reviewed_at"])
        self.assertEqual(result["article_status"], "rejected")

    def test_requests_revision_with_feedback(self):
        fake = FakeSupabase(
            books=[{"id": 9, "status": "pending_review"}],
            tags=[],
        )

        with patch("app.services.editor_service.supabase", fake):
            result = request_submission_revision(9, "请补足结尾的动机。")

        book = fake.rows["books"][0]
        self.assertEqual(book["status"], "revision_requested")
        self.assertEqual(book["editor_feedback"], "请补足结尾的动机。")
        self.assertEqual(result["article_status"], "revision_requested")

    def test_rejects_decision_after_submission_left_pending_state(self):
        fake = FakeSupabase(
            books=[{"id": 8, "status": "active"}],
            tags=[],
        )

        with patch("app.services.editor_service.supabase", fake):
            with self.assertRaises(SubmissionStateConflictError):
                reject_submission(8, "不能重复处理")


if __name__ == "__main__":
    unittest.main()
