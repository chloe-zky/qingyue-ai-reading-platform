import unittest
import hashlib
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from zipfile import ZIP_DEFLATED, ZipFile

from app.schemas.author import AuthorArticleCreate
from app.services.author_service import (
    AuthorReceiptError,
    AuthorSubmissionStateConflictError,
    _article_summary,
    _parse_reference,
    extract_docx_text,
    get_article_status,
    read_manuscript_upload,
    submit_article_for_author,
)


def build_docx(paragraphs):
    body = "".join(
        f'<w:p><w:r><w:t>{text}</w:t></w:r></w:p>' for text in paragraphs
    )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/'
        f'wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>'
    )
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", xml)
    return output.getvalue()


class ExtractDocxTextTests(unittest.TestCase):
    def test_extracts_paragraphs_without_writing_a_file(self):
        result = extract_docx_text("稿件.DOCX", build_docx(["第一段", "第二段"]))

        self.assertEqual(result["full_content"], "第一段\n\n第二段")
        self.assertEqual(result["character_count"], 6)

    def test_rejects_renamed_non_docx(self):
        with self.assertRaisesRegex(ValueError, "无法读取"):
            extract_docx_text("稿件.docx", b"not a zip")

    def test_rejects_legacy_doc_extension(self):
        with self.assertRaisesRegex(ValueError, "仅支持 .docx"):
            extract_docx_text("稿件.doc", b"content")

    def test_rejects_unsafe_xml_declaration(self):
        output = BytesIO()
        with ZipFile(output, "w", ZIP_DEFLATED) as archive:
            archive.writestr(
                "word/document.xml",
                '<!DOCTYPE x [<!ENTITY x "unsafe">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
            )
        with self.assertRaisesRegex(ValueError, "不安全的 XML"):
            extract_docx_text("稿件.docx", output.getvalue())


class FakeAsyncUpload:
    def __init__(self, content):
        self.content = content

    async def read(self, size=-1):
        if not self.content:
            return b""
        chunk, self.content = self.content[:size], self.content[size:]
        return chunk


class ManuscriptUploadLimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_stream_reader_rejects_oversized_upload(self):
        from app.services.author_service import MAX_MANUSCRIPT_BYTES

        upload = FakeAsyncUpload(b"x" * (MAX_MANUSCRIPT_BYTES + 1))
        with self.assertRaisesRegex(ValueError, "超过 20MB"):
            await read_manuscript_upload(upload)


class AuthorStatusTests(unittest.TestCase):
    def test_rejects_legacy_numeric_reference(self):
        with self.assertRaises(AuthorReceiptError):
            _parse_reference("BR-12")

    def test_parses_complete_secure_reference(self):
        token = "safe-token-with-more-than-twenty-characters"
        self.assertEqual(_parse_reference(f"BR-12-{token}"), (12, token))

    def test_exposes_rejection_feedback(self):
        result = _article_summary(
            {
                "id": 12,
                "title": "冬天",
                "author": "林夏",
                "status": "rejected",
                "editor_feedback": "题材不符",
                "reviewed_at": "2026-08-20T02:00:00+00:00",
            }
        )

        self.assertEqual(result["display_status"], "rejected")
        self.assertEqual(result["editor_feedback"], "题材不符")
        self.assertTrue(result["reviewed_at"])

    def test_exposes_revision_requested_status(self):
        result = _article_summary(
            {
                "id": 13,
                "title": "旧街",
                "author": "林夏",
                "status": "revision_requested",
                "editor_feedback": "请展开结尾",
            }
        )

        self.assertEqual(result["display_status"], "revision_requested")
        self.assertEqual(result["editor_feedback"], "请展开结尾")

    def test_status_lookup_filters_by_receipt_hash(self):
        token = "safe-token-with-more-than-twenty-characters"
        execute_result = SimpleNamespace(data=[{
            "id": 12,
            "title": "冬天",
            "author": "林夏",
            "status": "pending_review",
        }])
        query = MagicMock()
        query.select.return_value = query
        query.eq.return_value = query
        query.limit.return_value = query
        query.execute.return_value = execute_result
        fake = MagicMock()
        fake.table.return_value = query

        with patch("app.services.author_service.supabase", fake):
            result = get_article_status(f"BR-12-{token}")

        query.eq.assert_any_call("author_access_token_hash", hashlib.sha256(token.encode()).hexdigest())
        self.assertEqual(result["book_id"], 12)


class SubmitAuthorArticleTests(unittest.TestCase):
    def _article(self, revision_reference=None):
        return AuthorArticleCreate(
            title="冬天",
            author="林夏",
            intro="一封写给冬天的信。",
            sample="她在雪里找到旧信。",
            full_content="正文",
            revision_reference=revision_reference,
        )

    def test_new_submission_stores_only_token_hash(self):
        token = "fixed-token-with-more-than-twenty-characters"
        rpc_query = MagicMock()
        rpc_query.execute.return_value = SimpleNamespace(data={
            "book_id": 31,
            "revision_no": 1,
            "submitted_at": "2026-08-24T12:00:00+00:00",
        })
        fake = MagicMock()
        fake.rpc.return_value = rpc_query

        with patch("app.services.author_service.supabase", fake), patch(
            "app.services.author_service.secrets.token_urlsafe", return_value=token
        ), patch("app.services.author_service.extract_tags_for_book"):
            result = submit_article_for_author(self._article())

        rpc_name, payload = fake.rpc.call_args.args
        self.assertEqual(rpc_name, "submit_author_article_secure")
        self.assertEqual(payload["p_token_hash"], hashlib.sha256(token.encode()).hexdigest())
        self.assertNotIn(token, payload.values())
        self.assertEqual(result["reference_code"], f"BR-31-{token}")

    def test_resubmission_reports_invalid_receipt_without_leaking_database_error(self):
        token = "fixed-token-with-more-than-twenty-characters"
        rpc_query = MagicMock()
        rpc_query.execute.side_effect = RuntimeError("invalid author receipt")
        fake = MagicMock()
        fake.rpc.return_value = rpc_query

        with patch("app.services.author_service.supabase", fake):
            with self.assertRaisesRegex(AuthorReceiptError, "安全编号无效"):
                submit_article_for_author(self._article(f"BR-31-{token}"))

    def test_resubmission_rejects_non_revisable_state(self):
        token = "fixed-token-with-more-than-twenty-characters"
        rpc_query = MagicMock()
        rpc_query.execute.side_effect = RuntimeError("submission is not open for resubmission")
        fake = MagicMock()
        fake.rpc.return_value = rpc_query

        with patch("app.services.author_service.supabase", fake):
            with self.assertRaises(AuthorSubmissionStateConflictError):
                submit_article_for_author(self._article(f"BR-31-{token}"))


if __name__ == "__main__":
    unittest.main()
