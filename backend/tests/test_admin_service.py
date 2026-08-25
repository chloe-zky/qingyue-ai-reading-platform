import unittest
from unittest.mock import MagicMock, call, patch

import httpx

from app.schemas.admin import TestLLMConfigRequest, UpdateLLMConfigRequest
from app.services.admin_service import (
    LLMConnectionTestError,
    list_available_llm_models,
    test_llm_connection,
    update_llm_config,
)


class AdminServiceTests(unittest.TestCase):
    def setUp(self):
        self.allowed_hosts = patch(
            "app.utils.outbound_url.LLM_ALLOWED_HOSTS", ()
        )
        self.allowed_hosts.start()
        self.url_guard = patch(
            "app.services.admin_service.validate_llm_api_base",
            side_effect=lambda value: value.rstrip("/"),
        )
        self.url_guard.start()

    def tearDown(self):
        self.url_guard.stop()
        self.allowed_hosts.stop()

    def test_connection_test_limits_retry_and_timeout(self):
        request = TestLLMConfigRequest(
            api_base="https://example.com/v1",
            model_name="example-model",
        )
        self.assertEqual(request.timeout_seconds, 30)
        self.assertEqual(request.max_retries, 0)

    def test_blank_api_key_is_treated_as_omitted(self):
        request = UpdateLLMConfigRequest(
            api_base="https://example.com/v1",
            api_key="   ",
            model_name="example-model",
        )
        self.assertIsNone(request.api_key)

    def test_update_keeps_existing_key_when_request_omits_it(self):
        with patch(
            "app.services.admin_service.get_llm_api_key",
            return_value="existing-secret",
        ), patch("app.services.admin_service.update_config_value") as update, patch(
            "app.services.admin_service.store_llm_api_key"
        ) as store:
            update_llm_config(
                api_base="https://example.com/v1",
                api_key=None,
                model_name="example-model",
                timeout_seconds=45,
                max_retries=3,
            )

        updated_keys = [item.args[0] for item in update.call_args_list]
        self.assertNotIn("llm_api_key", updated_keys)
        store.assert_not_called()
        self.assertIn(call("llm_timeout_seconds", "45", "AI 请求超时秒数"), update.call_args_list)
        self.assertIn(call("llm_max_retries", "3", "AI 请求最大重试次数"), update.call_args_list)

    def test_first_configuration_requires_key(self):
        with patch(
            "app.services.admin_service.get_llm_api_key",
            return_value="",
        ), patch("app.services.admin_service.update_config_value") as update:
            with self.assertRaisesRegex(ValueError, "首次配置"):
                update_llm_config(
                    api_base="https://example.com/v1",
                    api_key=None,
                    model_name="example-model",
                )
        update.assert_not_called()

    def test_update_replaces_key_when_new_secret_is_present(self):
        with patch(
            "app.services.admin_service.get_llm_api_key",
            return_value="existing-secret",
        ), patch("app.services.admin_service.update_config_value") as update, patch(
            "app.services.admin_service.store_llm_api_key"
        ) as store:
            update_llm_config(
                api_base="https://example.com/v1",
                api_key="new-secret",
                model_name="example-model",
            )
        store.assert_called_once_with("new-secret")

    def test_update_preserves_omitted_timeout_and_retry_settings(self):
        with patch(
            "app.services.admin_service.get_llm_api_key",
            return_value="existing-secret",
        ), patch("app.services.admin_service.update_config_value") as update:
            update_llm_config(
                api_base="https://example.com/v1",
                api_key=None,
                model_name="example-model",
            )

        updated_keys = [item.args[0] for item in update.call_args_list]
        self.assertNotIn("llm_timeout_seconds", updated_keys)
        self.assertNotIn("llm_max_retries", updated_keys)

    def test_connection_test_uses_fixed_probe_and_existing_secret(self):
        response = httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"ok":true}'}}]},
            request=httpx.Request("POST", "https://example.com/v1/chat/completions"),
        )
        client = MagicMock()
        client.__enter__.return_value = client
        client.post.return_value = response
        with patch(
            "app.services.admin_service.get_llm_api_key",
            return_value="existing-secret",
        ), patch("app.services.admin_service.httpx.Client", return_value=client):
            result = test_llm_connection(
                api_base="https://example.com/v1",
                api_key=None,
                model_name="example-model",
                timeout_seconds=5,
            )

        self.assertEqual(result["status"], "ok")
        call_kwargs = client.post.call_args.kwargs
        self.assertEqual(call_kwargs["headers"]["Authorization"], "Bearer existing-secret")
        serialized_messages = str(call_kwargs["json"]["messages"])
        self.assertNotIn("稿件", serialized_messages)
        self.assertNotIn("existing-secret", str(call_kwargs["json"]))
        self.assertEqual(call_kwargs["json"]["max_tokens"], 256)

    def test_model_discovery_filters_noncanonical_and_duplicate_ids(self):
        response = httpx.Response(
            200,
            json={"data": [
                {"id": "gemini-3.5-flash"},
                {"id": "gemini-3-flash-preview"},
                {"id": "gemini-3.5-flash"},
                {"id": "假流式-gemini-3.5-flash"},
                {"id": "other-model"},
            ]},
            request=httpx.Request("GET", "https://example.com/v1/models"),
        )
        client = MagicMock()
        client.__enter__.return_value = client
        client.get.return_value = response
        with patch(
            "app.services.admin_service.get_llm_api_key",
            return_value="existing-secret",
        ), patch("app.services.admin_service.httpx.Client", return_value=client):
            result = list_available_llm_models(
                api_base="https://example.com/v1",
                api_key=None,
            )

        self.assertEqual(result, {
            "models": ["gemini-3-flash-preview", "gemini-3.5-flash"],
            "count": 2,
        })
        self.assertEqual(
            client.get.call_args.kwargs["headers"]["Authorization"],
            "Bearer existing-secret",
        )

    def test_connection_test_sanitizes_upstream_auth_failure(self):
        response = httpx.Response(
            401,
            json={"error": {"message": "secret upstream details"}},
            request=httpx.Request("POST", "https://example.com/v1/chat/completions"),
        )
        client = MagicMock()
        client.__enter__.return_value = client
        client.post.return_value = response
        with patch("app.services.admin_service.httpx.Client", return_value=client):
            with self.assertRaisesRegex(LLMConnectionTestError, "API Key") as raised:
                test_llm_connection(
                    api_base="https://example.com/v1",
                    api_key="bad-secret",
                    model_name="example-model",
                )
        self.assertNotIn("secret upstream details", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
