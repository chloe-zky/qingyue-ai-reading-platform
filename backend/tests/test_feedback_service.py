import unittest
from unittest.mock import patch

from app.schemas.feedback import FeedbackCreate
from app.services.feedback_service import create_feedback
from app.utils.reader_auth import ReaderPrincipal
from test_reader_service import FakeSupabase


def principal():
    return ReaderPrincipal(
        user_id="reader-1", email="reader@example.com", display_name="读者"
    )


def feedback(reason="推荐准确"):
    return FeedbackCreate(
        request_id="request-1",
        book_id=1,
        book_title="春日",
        reason=reason,
        user_prefs={"setting_tags": ["现代"]},
    )


class FeedbackServiceTests(unittest.TestCase):
    def test_authenticated_feedback_is_idempotent_and_updates_preferences_once(self):
        fake = FakeSupabase({"feedbacks": []})
        with patch("app.services.feedback_service.supabase", fake):
            first = create_feedback(feedback(), principal())
            second = create_feedback(feedback(), principal())
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(fake.tables["feedbacks"]), 1)

    def test_tag_accuracy_feedback_does_not_change_reader_taste(self):
        fake = FakeSupabase({"feedbacks": []})
        with patch("app.services.feedback_service.supabase", fake):
            create_feedback(feedback("标签不准"), principal())
        self.assertEqual(fake.tables["feedbacks"][0]["reason"], "标签不准")


if __name__ == "__main__":
    unittest.main()
