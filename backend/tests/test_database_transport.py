import unittest
from types import SimpleNamespace
from unittest.mock import patch

import httpx

from app.database import (
    IDEMPOTENT_METHODS,
    RetryingTransport,
    install_retrying_transport,
)


def request(method: str) -> httpx.Request:
    return httpx.Request(method, "https://example.supabase.co/rest/v1/books")


class RetryingTransportTests(unittest.TestCase):
    def setUp(self):
        # Zero backoff keeps the retry semantics under test without the wait.
        patcher = patch("app.database.TRANSPORT_BACKOFF_SECONDS", 0)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_idempotent_request_retries_a_dropped_connection(self):
        calls = []

        def handle(self, req):
            calls.append(req.method)
            if len(calls) == 1:
                raise httpx.ReadError("[Errno 35] Resource temporarily unavailable")
            return httpx.Response(200)

        with patch.object(httpx.HTTPTransport, "handle_request", handle):
            response = RetryingTransport().handle_request(request("GET"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls, ["GET", "GET"])

    def test_post_is_never_retried_because_it_may_have_been_applied(self):
        calls = []

        def handle(self, req):
            calls.append(req.method)
            raise httpx.ReadError("[Errno 35] Resource temporarily unavailable")

        with patch.object(httpx.HTTPTransport, "handle_request", handle):
            with self.assertRaises(httpx.ReadError):
                RetryingTransport().handle_request(request("POST"))

        self.assertEqual(calls, ["POST"])

    def test_persistent_failure_still_surfaces_after_the_last_attempt(self):
        calls = []

        def handle(self, req):
            calls.append(req.method)
            raise httpx.ConnectError("connection refused")

        with patch.object(httpx.HTTPTransport, "handle_request", handle):
            with self.assertRaises(httpx.ConnectError):
                RetryingTransport().handle_request(request("GET"))

        self.assertEqual(len(calls), 3)

    def test_successful_request_is_sent_exactly_once(self):
        calls = []

        def handle(self, req):
            calls.append(req.method)
            return httpx.Response(204)

        with patch.object(httpx.HTTPTransport, "handle_request", handle):
            RetryingTransport().handle_request(request("GET"))

        self.assertEqual(calls, ["GET"])

    def test_business_errors_are_not_retried(self):
        # A 500 from PostgREST is a response, not a transport failure: retrying
        # it would hammer a struggling database.
        calls = []

        def handle(self, req):
            calls.append(req.method)
            return httpx.Response(500)

        with patch.object(httpx.HTTPTransport, "handle_request", handle):
            response = RetryingTransport().handle_request(request("GET"))

        self.assertEqual(response.status_code, 500)
        self.assertEqual(calls, ["GET"])

    def test_write_methods_are_excluded_from_the_idempotent_set(self):
        self.assertNotIn("POST", IDEMPOTENT_METHODS)
        self.assertNotIn("PATCH", IDEMPOTENT_METHODS)
        self.assertIn("GET", IDEMPOTENT_METHODS)


class TransportInstallationTests(unittest.TestCase):
    def test_every_supabase_sub_client_is_hardened(self):
        # Guards against an httpx/supabase upgrade moving these internals and
        # silently leaving the application with no retries at all.
        client = SimpleNamespace(
            postgrest=SimpleNamespace(session=httpx.Client()),
            auth=SimpleNamespace(_http_client=httpx.Client()),
            storage=SimpleNamespace(session=httpx.Client()),
        )
        hardened = install_retrying_transport(client)

        self.assertEqual(hardened, ["postgrest", "auth", "storage"])
        self.assertIsInstance(client.postgrest.session._transport, RetryingTransport)
        self.assertIsInstance(client.auth._http_client._transport, RetryingTransport)
        self.assertIsInstance(client.storage.session._transport, RetryingTransport)

    def test_unknown_client_shape_is_skipped_instead_of_crashing(self):
        client = SimpleNamespace(
            postgrest=SimpleNamespace(session=None),
            auth=SimpleNamespace(),
            storage=SimpleNamespace(session="not a client"),
        )
        self.assertEqual(install_retrying_transport(client), [])

    def test_live_client_has_the_retrying_transport_installed(self):
        from app.database import supabase

        session = supabase.postgrest.session
        self.assertIsInstance(session._transport, RetryingTransport)


if __name__ == "__main__":
    unittest.main()
