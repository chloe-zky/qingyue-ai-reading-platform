import unittest
from unittest.mock import Mock, patch

import httpx

from app.services.gemini_service import call_openai_compatible_llm


def _client_context(client):
    context = Mock()
    context.__enter__ = Mock(return_value=client)
    context.__exit__ = Mock(return_value=False)
    return context


class LLMRequestTests(unittest.TestCase):
    def setUp(self):
        self.url_guard = patch(
            "app.services.gemini_service.validate_llm_api_base",
            side_effect=lambda value: value.rstrip("/"),
        )
        self.url_guard.start()

    def tearDown(self):
        self.url_guard.stop()

    def test_uses_configured_timeout(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "choices": [{"message": {"content": "{\"ok\": true}"}}]
        }
        client = Mock()
        client.post.return_value = response

        with patch(
            "app.services.gemini_service.httpx.Client",
            return_value=_client_context(client),
        ) as client_factory:
            result = call_openai_compatible_llm(
                "https://example.com/v1",
                "secret",
                "model",
                "prompt",
                timeout_seconds=17,
                max_retries=0,
            )

        self.assertEqual(result, '{"ok": true}')
        client_factory.assert_called_once_with(timeout=17.0)
        self.assertEqual(client.post.call_count, 1)

    def test_retries_transient_status(self):
        request = httpx.Request("POST", "https://example.com/v1/chat/completions")
        transient_response = httpx.Response(503, request=request)
        transient = httpx.HTTPStatusError(
            "temporary",
            request=request,
            response=transient_response,
        )
        first = Mock()
        first.raise_for_status.side_effect = transient
        second = Mock()
        second.raise_for_status.return_value = None
        second.json.return_value = {
            "choices": [{"message": {"content": "done"}}]
        }
        client = Mock()
        client.post.side_effect = [first, second]

        with patch(
            "app.services.gemini_service.httpx.Client",
            return_value=_client_context(client),
        ), patch("app.services.gemini_service.time.sleep") as sleep:
            result = call_openai_compatible_llm(
                "https://example.com/v1",
                "secret",
                "model",
                "prompt",
                max_retries=2,
            )

        self.assertEqual(result, "done")
        self.assertEqual(client.post.call_count, 2)
        sleep.assert_called_once_with(0.25)

    def test_does_not_retry_client_error(self):
        request = httpx.Request("POST", "https://example.com/v1/chat/completions")
        response = httpx.Response(400, request=request)
        client_error = httpx.HTTPStatusError(
            "bad request",
            request=request,
            response=response,
        )
        failed = Mock()
        failed.raise_for_status.side_effect = client_error
        client = Mock()
        client.post.return_value = failed

        with patch(
            "app.services.gemini_service.httpx.Client",
            return_value=_client_context(client),
        ), patch("app.services.gemini_service.time.sleep") as sleep:
            with self.assertRaises(httpx.HTTPStatusError):
                call_openai_compatible_llm(
                    "https://example.com/v1",
                    "secret",
                    "model",
                    "prompt",
                    max_retries=3,
                )

        self.assertEqual(client.post.call_count, 1)
        sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
