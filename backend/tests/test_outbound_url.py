import socket
import unittest
from unittest.mock import patch

from app.utils.outbound_url import validate_llm_api_base


def record(address: str):
    return (socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))


class OutboundUrlTests(unittest.TestCase):
    def test_rejects_private_and_loopback_even_when_host_is_allowlisted(self):
        for address in ("127.0.0.1", "10.0.0.8", "192.168.1.2"):
            with self.subTest(address=address), patch(
                "app.utils.outbound_url.LLM_ALLOWED_HOSTS", ("ai.example.com",)
            ), patch("app.utils.outbound_url.LLM_TRUST_PROXY_DNS", True), patch(
                "app.utils.outbound_url.socket.getaddrinfo",
                return_value=[record(address)],
            ):
                with self.assertRaisesRegex(ValueError, "私网或保留地址"):
                    validate_llm_api_base("https://ai.example.com/v1")

    def test_proxy_fake_ip_requires_exact_allowlist_and_opt_in(self):
        cases = (
            ((), True),
            (("*.example.com",), True),
            (("ai.example.com",), False),
        )
        for allowed, enabled in cases:
            with self.subTest(allowed=allowed, enabled=enabled), patch(
                "app.utils.outbound_url.LLM_ALLOWED_HOSTS", allowed
            ), patch("app.utils.outbound_url.LLM_TRUST_PROXY_DNS", enabled), patch(
                "app.utils.outbound_url.socket.getaddrinfo",
                return_value=[record("198.18.0.73")],
            ):
                with self.assertRaises(ValueError):
                    validate_llm_api_base("https://ai.example.com/v1")

    def test_exact_allowlist_can_use_proxy_fake_ip_when_explicitly_enabled(self):
        with patch(
            "app.utils.outbound_url.LLM_ALLOWED_HOSTS", ("ai.example.com",)
        ), patch("app.utils.outbound_url.LLM_TRUST_PROXY_DNS", True), patch(
            "app.utils.outbound_url.socket.getaddrinfo",
            return_value=[record("198.18.0.73")],
        ):
            self.assertEqual(
                validate_llm_api_base("https://ai.example.com/v1/"),
                "https://ai.example.com/v1",
            )

    def test_public_ip_still_works_without_proxy_exception(self):
        with patch("app.utils.outbound_url.LLM_ALLOWED_HOSTS", ()), patch(
            "app.utils.outbound_url.LLM_TRUST_PROXY_DNS", False
        ), patch(
            "app.utils.outbound_url.socket.getaddrinfo",
            return_value=[record("8.8.8.8")],
        ):
            self.assertEqual(
                validate_llm_api_base("https://ai.example.com/v1"),
                "https://ai.example.com/v1",
            )


if __name__ == "__main__":
    unittest.main()
