import unittest

from app.services.upload_service import _read_and_validate


class FakeUpload:
    def __init__(self, content_type, content):
        self.content_type = content_type
        self._content = content

    async def read(self, size=-1):
        if not self._content:
            return b""
        if size is None or size < 0:
            size = len(self._content)
        chunk, self._content = self._content[:size], self._content[size:]
        return chunk


class UploadValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_accepts_png_with_matching_signature(self):
        content = (
            b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR"
            + (640).to_bytes(4, "big") + (480).to_bytes(4, "big") + b"payload"
        )
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

    async def test_rejects_decompression_bomb_dimensions(self):
        content = (
            b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR"
            + (9000).to_bytes(4, "big") + (9000).to_bytes(4, "big") + b"payload"
        )
        with self.assertRaisesRegex(ValueError, "总像素过大"):
            await _read_and_validate(FakeUpload("image/png", content))


if __name__ == "__main__":
    unittest.main()
