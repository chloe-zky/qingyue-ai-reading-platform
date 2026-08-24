import unittest
from unittest.mock import call, patch

from app.schemas.admin import UpdateLLMConfigRequest
from app.services.admin_service import update_llm_config


class AdminServiceTests(unittest.TestCase):
    def test_blank_api_key_is_treated_as_omitted(self):
        request = UpdateLLMConfigRequest(
            api_base="https://example.com/v1",
            api_key="   ",
            model_name="example-model",
        )
        self.assertIsNone(request.api_key)

    def test_update_keeps_existing_key_when_request_omits_it(self):
        with patch(
            "app.services.admin_service.get_config_value",
            return_value="existing-secret",
        ), patch("app.services.admin_service.update_config_value") as update:
            update_llm_config(
                api_base="https://example.com/v1",
                api_key=None,
                model_name="example-model",
                timeout_seconds=45,
                max_retries=3,
            )

        updated_keys = [item.args[0] for item in update.call_args_list]
        self.assertNotIn("llm_api_key", updated_keys)
        self.assertIn(call("llm_timeout_seconds", "45", "AI 请求超时秒数"), update.call_args_list)
        self.assertIn(call("llm_max_retries", "3", "AI 请求最大重试次数"), update.call_args_list)

    def test_first_configuration_requires_key(self):
        with patch(
            "app.services.admin_service.get_config_value",
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
            "app.services.admin_service.get_config_value",
            return_value="existing-secret",
        ), patch("app.services.admin_service.update_config_value") as update:
            update_llm_config(
                api_base="https://example.com/v1",
                api_key="new-secret",
                model_name="example-model",
            )
        self.assertIn(
            call("llm_api_key", "new-secret", "OpenAI compatible API Key"),
            update.call_args_list,
        )

    def test_update_preserves_omitted_timeout_and_retry_settings(self):
        with patch(
            "app.services.admin_service.get_config_value",
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


if __name__ == "__main__":
    unittest.main()
