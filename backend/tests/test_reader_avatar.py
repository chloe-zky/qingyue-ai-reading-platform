import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.services.reader_service import safe_avatar_url, set_reader_avatar
from app.utils.reader_auth import ReaderPrincipal, get_current_reader


def principal(display_name="读者", avatar_url=""):
    return ReaderPrincipal(
        user_id="reader-1",
        email="reader@example.com",
        display_name=display_name,
        avatar_url=avatar_url,
    )


# 从实际配置推导，别写死域名——本地 .env 与 CI 的 SUPABASE_URL 并不相同，
# 写死会让这组断言只在其中一个环境成立。
from app.config import SUPABASE_URL  # noqa: E402

STORAGE_ROOT = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/public/covers"
AVATAR_URL = f"{STORAGE_ROOT}/avatars/reader-1.jpg?v=1"


class SetReaderAvatarTests(unittest.TestCase):
    def run_set(self, current=None, url=AVATAR_URL, existing_metadata=None, read_fails=False):
        admin = MagicMock()
        if read_fails:
            admin.get_user_by_id.side_effect = RuntimeError("unreachable")
        else:
            admin.get_user_by_id.return_value = SimpleNamespace(
                user=SimpleNamespace(user_metadata=dict(existing_metadata or {}))
            )
        fake = SimpleNamespace(auth=SimpleNamespace(admin=admin))
        with patch("app.services.reader_service.supabase", fake), patch(
            "app.services.reader_service.forget_reader"
        ) as forget:
            result = set_reader_avatar(current or principal(), url)
        _uid, attributes = admin.update_user_by_id.call_args.args
        return admin, forget, result, attributes["user_metadata"]

    def test_avatar_is_written_to_auth_metadata_not_a_new_table(self):
        """头像存在 Auth 元数据里，正是为了不用给 reader_profiles 加列。

        这条断言把那个设计意图钉住：一旦有人改成写库，就必须重新面对
        「需要 DDL 迁移、而迁移要另行授权」这件事。
        """
        admin, _forget, result, metadata = self.run_set()

        admin.update_user_by_id.assert_called_once()
        self.assertEqual(admin.update_user_by_id.call_args.args[0], "reader-1")
        self.assertEqual(metadata["avatar_url"], AVATAR_URL)
        self.assertEqual(result["avatar_url"], AVATAR_URL)

    def test_existing_metadata_is_merged_not_replaced(self):
        # 显式合并，不赌 GoTrue 的版本行为：OAuth 之类写进来的键必须留着。
        _admin, _forget, _result, metadata = self.run_set(
            existing_metadata={"display_name": "Chloe", "provider_id": "abc"},
        )
        self.assertEqual(metadata["display_name"], "Chloe")
        self.assertEqual(metadata["provider_id"], "abc")
        self.assertEqual(metadata["avatar_url"], AVATAR_URL)

    def test_metadata_read_failure_still_preserves_the_display_name(self):
        _admin, _forget, _result, metadata = self.run_set(
            principal(display_name="Chloe"), read_fails=True,
        )
        self.assertEqual(metadata["display_name"], "Chloe")
        self.assertEqual(metadata["avatar_url"], AVATAR_URL)

    def test_only_this_reader_is_dropped_from_the_token_cache(self):
        # 旧实现清空整张缓存，会让所有读者下一次请求都重新走一遍网络校验。
        _admin, forget, _result, _metadata = self.run_set()
        forget.assert_called_once_with("reader-1")


class SafeAvatarUrlTests(unittest.TestCase):
    """user_metadata 用户自己就能改，所以读出来的头像地址必须过白名单。"""

    def test_our_own_storage_url_passes(self):
        self.assertEqual(safe_avatar_url(AVATAR_URL), AVATAR_URL)

    def test_foreign_hosts_are_dropped(self):
        for hostile in (
            "https://evil.example.com/track.gif",
            AVATAR_URL.replace("https://", "http://"),   # 降级到明文也不放行
            "javascript:alert(1)",
            "data:image/png;base64,AAAA",
        ):
            self.assertEqual(safe_avatar_url(hostile), "", hostile)

    def test_other_paths_in_our_bucket_are_dropped(self):
        # 只认 avatars/ 目录，不给「把封面当头像」或路径穿越留口子。
        self.assertEqual(
            safe_avatar_url(f"{STORAGE_ROOT}/optimized/book-18-720.jpg"), ""
        )

    def test_blank_values_are_normalised(self):
        for blank in ("", "   ", None):
            self.assertEqual(safe_avatar_url(blank), "")


class ReaderAvatarApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def sign_in(self, current=None):
        app.dependency_overrides[get_current_reader] = lambda: current or principal()

    def test_upload_requires_a_reader_token(self):
        response = self.client.post(
            "/api/reader/avatar", files={"file": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
        )
        self.assertEqual(response.status_code, 401)

    def test_upload_stores_then_persists_the_url(self):
        self.sign_in()
        uploaded = {"avatar_url": "https://cdn/avatars/reader-1.jpg?v=7"}

        async def fake_upload(_file, user_id):
            self.assertEqual(user_id, "reader-1")   # 只能写自己的对象
            return uploaded

        with patch("app.routers.readers.upload_reader_avatar", fake_upload), patch(
            "app.routers.readers.set_reader_avatar", return_value=uploaded
        ) as save:
            response = self.client.post(
                "/api/reader/avatar",
                files={"file": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), uploaded)
        save.assert_called_once()

    def test_rejected_image_returns_400_and_never_persists(self):
        self.sign_in()

        async def fake_upload(_file, _user_id):
            raise ValueError("不支持的图片类型")

        with patch("app.routers.readers.upload_reader_avatar", fake_upload), patch(
            "app.routers.readers.set_reader_avatar"
        ) as save:
            response = self.client.post(
                "/api/reader/avatar",
                files={"file": ("a.txt", b"hello", "text/plain")},
            )

        self.assertEqual(response.status_code, 400)
        save.assert_not_called()

    def test_profile_exposes_the_avatar_from_the_principal(self):
        current = principal(avatar_url="https://cdn/avatars/reader-1.jpg?v=3")
        self.sign_in(current)
        profile = {
            "user_id": current.user_id,
            "email": current.email,
            "display_name": "读者",
            "avatar_url": current.avatar_url,
            "reader_days": 1,
            "favorites_count": 0,
            "history_count": 0,
            "personalization_enabled": True,
            "created_at": "2026-09-06T00:00:00+00:00",
        }
        with patch("app.routers.readers.get_reader_profile", return_value=profile):
            response = self.client.get("/api/reader/me")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["avatar_url"], current.avatar_url)


if __name__ == "__main__":
    unittest.main()
