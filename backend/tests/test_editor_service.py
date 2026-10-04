import copy
import unittest
from datetime import datetime, timedelta, timezone
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


class FakeRpcQuery:
    def __init__(self, database, name, params):
        self.database = database
        self.name = name
        self.params = copy.deepcopy(params)

    def execute(self):
        return self.database.execute_rpc(self.name, self.params)


class FakeSupabase:
    def __init__(self, books, tags, fail_publish=False):
        self.rows = {
            "books": copy.deepcopy(books),
            "book_ai_tags": copy.deepcopy(tags),
        }
        self.fail_publish = fail_publish
        self.rpc_calls = []

    def table(self, table_name):
        return FakeQuery(self, table_name)

    def rpc(self, name, params):
        self.rpc_calls.append((name, copy.deepcopy(params)))
        return FakeRpcQuery(self, name, params)

    def execute_rpc(self, name, params):
        if name != "publish_reviewed_book":
            raise AssertionError(f"unsupported rpc: {name}")
        if self.fail_publish:
            raise RuntimeError("simulated atomic publish failure")
        book = next(
            (row for row in self.rows["books"] if row.get("id") == params["p_book_id"]),
            None,
        )
        if not book:
            raise RuntimeError("P0002 稿件不存在")
        if book.get("status") != "pending_review":
            raise RuntimeError("22023 不能重复审核通过")

        tag_payload = {
            "book_id": params["p_book_id"],
            **copy.deepcopy(params["p_tags"]),
            "tag_status": "confirmed",
            "tag_source": "ai_reviewed",
        }
        tags = self.rows["book_ai_tags"]
        existing = next(
            (row for row in tags if row.get("book_id") == params["p_book_id"]),
            None,
        )
        if existing:
            existing.update(tag_payload)
        else:
            tags.append(tag_payload)
        book.update({
            "status": "active",
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
            "review_claimed_by": None,
            "review_claimed_at": None,
            "review_claim_expires_at": None,
            **copy.deepcopy(params["p_cover"]),
        })
        return SimpleNamespace(data={
            "book_id": params["p_book_id"],
            "article_status": "active",
            "tag_status": "confirmed",
        })

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
        aesthetic_tags=["克制"],
        recommend_reason="适合轻阅读",
    )


def published_vocabularies():
    return {
        "setting_tags": ["现代", "古风", "民国"],
        "story_tone_tags": ["温暖治愈", "清甜校园", "遗憾青春", "浓情曲折"],
        "relationship_core_tags": ["相伴成长", "暗恋未明", "久别重逢", "命运拉扯"],
        "aesthetic_tags": ["克制"],
        "risk_tags": ["情感背叛"],
    }


class ApproveSubmissionTests(unittest.TestCase):
    def test_approves_pending_submission(self):
        fake = FakeSupabase(
            books=[{"id": 8, "status": "pending_review"}],
            tags=[{"book_id": 8, "tag_status": "draft", "tag_source": "ai"}],
        )

        with patch("app.services.editor_service.supabase", fake), patch(
            "app.services.editor_service.get_valid_vocabularies",
            return_value=published_vocabularies(),
        ), patch("app.services.editor_service.clear_recommendation_cache") as clear_cache:
            result = approve_submission(8, approval_request(), "current-editor")

        self.assertEqual(fake.rows["books"][0]["status"], "active")
        self.assertTrue(fake.rows["books"][0]["reviewed_at"])
        self.assertEqual(fake.rows["book_ai_tags"][0]["tag_status"], "confirmed")
        self.assertEqual(result["article_status"], "active")
        self.assertEqual(fake.rpc_calls[0][0], "publish_reviewed_book")
        self.assertEqual(fake.rpc_calls[0][1]["p_actor"], "current-editor")
        clear_cache.assert_called_once_with()

    def test_rejects_duplicate_approval(self):
        fake = FakeSupabase(
            books=[{"id": 8, "status": "active"}],
            tags=[{"book_id": 8, "tag_status": "confirmed"}],
        )

        with patch("app.services.editor_service.supabase", fake), patch(
            "app.services.editor_service.get_valid_vocabularies",
            return_value=published_vocabularies(),
        ):
            with self.assertRaises(SubmissionStateConflictError):
                approve_submission(8, approval_request(), "current-editor")

    def test_atomic_failure_leaves_book_and_draft_tags_unchanged(self):
        original_tags = {
            "book_id": 8,
            "tag_status": "draft",
            "tag_source": "ai",
            "setting_tags": ["旧标签"],
        }
        fake = FakeSupabase(
            books=[{"id": 8, "status": "pending_review"}],
            tags=[original_tags],
            fail_publish=True,
        )

        with patch("app.services.editor_service.supabase", fake), patch(
            "app.services.editor_service.get_valid_vocabularies",
            return_value=published_vocabularies(),
        ):
            with self.assertRaisesRegex(RuntimeError, "原子发布失败"):
                approve_submission(8, approval_request(), "current-editor")

        self.assertEqual(fake.rows["book_ai_tags"][0], original_tags)
        self.assertEqual(fake.rows["books"][0]["status"], "pending_review")

    def test_rejects_out_of_vocabulary_tags_before_publish(self):
        fake = FakeSupabase(
            books=[{"id": 8, "status": "pending_review"}],
            tags=[{"book_id": 8, "tag_status": "draft"}],
        )
        request = approval_request().model_copy(
            update={"aesthetic_tags": ["未发布风格"]}
        )
        with patch("app.services.editor_service.supabase", fake), patch(
            "app.services.editor_service.get_valid_vocabularies",
            return_value=published_vocabularies(),
        ):
            with self.assertRaisesRegex(ValueError, "未发布风格"):
                approve_submission(8, request, "current-editor")

        self.assertEqual(fake.rpc_calls, [])


class EditorDecisionTests(unittest.TestCase):
    def test_requires_current_editor_to_own_active_claim(self):
        fake = FakeSupabase(
            books=[{
                "id": 8,
                "status": "pending_review",
                "review_claimed_by": "other-editor",
                "review_claim_expires_at": (
                    datetime.now(timezone.utc) + timedelta(minutes=20)
                ).isoformat(),
            }],
            tags=[],
        )

        with patch("app.services.editor_service.supabase", fake):
            with self.assertRaisesRegex(SubmissionStateConflictError, "先认领"):
                reject_submission(8, "不通过", "current-editor")

    def test_claim_owner_can_submit_decision_and_claim_is_released(self):
        fake = FakeSupabase(
            books=[{
                "id": 8,
                "status": "pending_review",
                "review_claimed_by": "current-editor",
                "review_claim_expires_at": (
                    datetime.now(timezone.utc) + timedelta(minutes=20)
                ).isoformat(),
            }],
            tags=[],
        )

        with patch("app.services.editor_service.supabase", fake):
            result = reject_submission(8, "不通过", "current-editor")

        self.assertEqual(result["article_status"], "rejected")
        self.assertIsNone(fake.rows["books"][0]["review_claimed_by"])

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
