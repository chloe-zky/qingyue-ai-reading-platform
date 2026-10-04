import unittest
from unittest.mock import MagicMock, patch

from app.services.upload_service import _read_and_validate, upload_cover_image


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
    @staticmethod
    def jpeg(width=540, height=720):
        return (
            b"\xff\xd8\xff\xc0\x00\x11\x08"
            + height.to_bytes(2, "big")
            + width.to_bytes(2, "big")
            + b"\x00" * 10
        )

    async def test_accepts_optimized_jpeg(self):
        content = self.jpeg()
        data, content_type, ext = await _read_and_validate(
            FakeUpload("image/jpeg", content)
        )

        self.assertEqual(data, content)
        self.assertEqual(content_type, "image/jpeg")
        self.assertEqual(ext, "jpg")

    async def test_rejects_forged_mime_type(self):
        with self.assertRaisesRegex(ValueError, "内容与声明格式不一致"):
            await _read_and_validate(FakeUpload("image/jpeg", b"plain text"))

    async def test_rejects_unsupported_type(self):
        with self.assertRaisesRegex(ValueError, "仅接收已压缩的 JPEG"):
            await _read_and_validate(FakeUpload("image/gif", b"GIF89a"))

    async def test_rejects_jpeg_larger_than_720px(self):
        with self.assertRaisesRegex(ValueError, "长边上限为 720"):
            await _read_and_validate(FakeUpload("image/jpeg", self.jpeg(721, 480)))

    async def test_uploaded_uuid_cover_uses_one_year_cache(self):
        content = self.jpeg()
        storage = MagicMock()
        storage.get_public_url.return_value = (
            "https://example.supabase.co/storage/v1/object/public/covers/optimized/unique-cover.jpg"
        )
        fake = MagicMock()
        fake.storage.from_.return_value = storage

        with patch("app.services.upload_service.supabase", fake), patch(
            "app.services.upload_service._build_object_name",
            return_value="optimized/unique-cover.jpg",
        ):
            result = await upload_cover_image(FakeUpload("image/jpeg", content))

        options = storage.upload.call_args.kwargs["file_options"]
        self.assertEqual(options["cache-control"], "31536000")
        self.assertEqual(options["upsert"], "false")
        self.assertEqual(result["storage_path"], "optimized/unique-cover.jpg")


if __name__ == "__main__":
    unittest.main()
