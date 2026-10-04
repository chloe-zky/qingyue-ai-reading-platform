import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.security import HTTPAuthorizationCredentials

from app.utils import reader_auth
from app.utils.reader_auth import (
    ReaderPrincipal, clear_reader_auth_cache, get_current_reader, get_optional_reader,
)


def credentials(token="token-a"):
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def auth_user(user_id="reader-1"):
    return SimpleNamespace(
        user=SimpleNamespace(
            id=user_id,
            email=f"{user_id}@example.com",
            user_metadata={"display_name": "读者"},
        )
    )


class FakeAuth:
    """记录 get_user 调用次数的替身，用来验证网络往返是否真的被省掉。"""

    def __init__(self, user=None, error=None):
        self.calls = []
        self._user = user or auth_user()
        self._error = error

    def get_user(self, token):
        self.calls.append(token)
        if self._error:
            raise self._error
        return self._user


class ReaderAuthCacheTests(unittest.TestCase):
    def setUp(self):
        clear_reader_auth_cache()
        self.addCleanup(clear_reader_auth_cache)

    def resolve(self, fake, token="token-a"):
        with patch.object(reader_auth, "supabase", SimpleNamespace(auth=fake)):
            return get_current_reader(credentials(token))

    def test_same_token_validates_over_the_network_only_once(self):
        fake = FakeAuth()
        first = self.resolve(fake)
        second = self.resolve(fake)

        self.assertEqual(len(fake.calls), 1)
        self.assertEqual(first, second)
        self.assertEqual(second.user_id, "reader-1")

    def test_different_tokens_are_validated_separately(self):
        fake = FakeAuth()
        self.resolve(fake, "token-a")
        self.resolve(fake, "token-b")
        self.assertEqual(len(fake.calls), 2)

    def test_expired_entry_is_revalidated(self):
        fake = FakeAuth()
        self.resolve(fake)
        with patch.object(reader_auth, "AUTH_CACHE_TTL_SECONDS", 0):
            clear_reader_auth_cache()
            self.resolve(fake)
            self.resolve(fake)
        # TTL 为 0 时每次都必须重新校验。
        self.assertEqual(len(fake.calls), 3)

    def test_failed_validation_is_never_cached(self):
        fake = FakeAuth(error=RuntimeError("invalid"))
        for _ in range(3):
            with self.assertRaises(Exception):
                self.resolve(fake)
        # 失败不写缓存：否则一次网络抖动会把有效令牌钉死在 401 上。
        self.assertEqual(len(fake.calls), 3)

    def test_cache_key_is_a_hash_not_the_token(self):
        fake = FakeAuth()
        self.resolve(fake, "super-secret-token")
        keys = list(reader_auth._auth_cache)
        self.assertTrue(keys)
        for key in keys:
            self.assertNotIn("super-secret-token", key)
            self.assertEqual(len(key), 64)   # SHA-256 十六进制

    def test_cache_is_bounded(self):
        fake = FakeAuth()
        with patch.object(reader_auth, "AUTH_CACHE_MAX_ENTRIES", 3):
            for index in range(10):
                self.resolve(fake, f"token-{index}")
        self.assertLessEqual(len(reader_auth._auth_cache), 3)

    def test_optional_reader_shares_the_same_cache(self):
        fake = FakeAuth()
        self.resolve(fake)
        with patch.object(reader_auth, "supabase", SimpleNamespace(auth=fake)):
            principal = get_optional_reader(credentials())
        self.assertEqual(len(fake.calls), 1)
        self.assertIsInstance(principal, ReaderPrincipal)

    def test_anonymous_request_never_touches_auth(self):
        fake = FakeAuth()
        with patch.object(reader_auth, "supabase", SimpleNamespace(auth=fake)):
            self.assertIsNone(get_optional_reader(None))
        self.assertEqual(fake.calls, [])


if __name__ == "__main__":
    unittest.main()
