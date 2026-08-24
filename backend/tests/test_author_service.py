import unittest
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from app.services.author_service import _article_summary, extract_docx_text


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


class AuthorStatusTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
