import base64
import os
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services.secret_service import (
    SecretConfigurationError,
    SecretDecryptionError,
    decrypt_secret,
    encrypt_secret,
    parse_master_keys,
    store_llm_api_key,
)


def key_ring(key_id="v1"):
    return f"{key_id}:{base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('=')}"


class SecretServiceTests(unittest.TestCase):
    def test_aes_gcm_round_trip_does_not_embed_plaintext(self):
        ring = key_ring()
        encrypted = encrypt_secret("super-secret-value", ring)
        self.assertNotIn("super-secret-value", encrypted["ciphertext"])
        self.assertEqual(decrypt_secret(encrypted["ciphertext"], ring), "super-secret-value")

    def test_old_key_remains_decryptable_during_rotation(self):
        old = key_ring("old")
        encrypted = encrypt_secret("secret", old)
        new = key_ring("new")
        combined = f"{new},{old}"
        self.assertEqual(decrypt_secret(encrypted["ciphertext"], combined), "secret")
        self.assertEqual(encrypt_secret("secret", combined)["key_id"], "new")

    def test_rejects_invalid_key_length_and_unknown_version(self):
        with self.assertRaises(SecretConfigurationError):
            parse_master_keys("v1:dG9vLXNob3J0")
        encrypted = encrypt_secret("secret", key_ring("old"))
        with self.assertRaises(SecretDecryptionError):
            decrypt_secret(encrypted["ciphertext"], key_ring("new"))

    def test_store_uses_atomic_rpc_and_never_plaintext_table(self):
        rpc = MagicMock()
        rpc.execute.return_value = SimpleNamespace(data=None)
        fake = MagicMock()
        fake.rpc.return_value = rpc
        with patch("app.services.secret_service.supabase", fake), patch(
            "app.services.secret_service.LLM_CONFIG_MASTER_KEYS", key_ring()
        ):
            store_llm_api_key("super-secret-value")
        fake.table.assert_not_called()
        name, payload = fake.rpc.call_args.args
        self.assertEqual(name, "store_encrypted_system_secret")
        self.assertNotIn("super-secret-value", str(payload))


if __name__ == "__main__":
    unittest.main()
