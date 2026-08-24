import unittest

from app.services.upload_service import _read_and_validate


class FakeUpload:
    def __init__(self, content_type, content):
        self.content_type = content_type
        self._content = content

    async def read(self):
        return self._content


class UploadValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_accepts_png_with_matching_signature(self):
        content = b"\x89PNG\r\n\x1a\n" + b"payload"
        data, content_type, ext = await _read_and_validate(
            FakeUpload("image/png", content)
        )

        self.assertEqual(data, content)
        self.assertEqual(content_type, "image/png")
        self.assertEqual(ext, "png")

    async def test_rejects_forged_mime_type(self):
        with self.assertRaisesRegex(ValueError, "内容与声明格式不一致"):
            await _read_and_validate(FakeUpload("image/png", b"plain text"))

    async def test_rejects_unsupported_type(self):
        with self.assertRaisesRegex(ValueError, "仅支持 JPEG / PNG / WebP"):
            await _read_and_validate(FakeUpload("image/gif", b"GIF89a"))


if __name__ == "__main__":
    unittest.main()
