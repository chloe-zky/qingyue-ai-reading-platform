import unittest
from unittest.mock import Mock, patch

import httpx

from app.utils.retry import retry_transport


class TransportRetryTests(unittest.TestCase):
    def test_retries_one_transport_failure(self):
        operation = Mock(side_effect=[httpx.RemoteProtocolError("closed"), "ok"])
        with patch("app.utils.retry.time.sleep") as sleep:
            result = retry_transport(operation)
        self.assertEqual(result, "ok")
        self.assertEqual(operation.call_count, 2)
        sleep.assert_called_once_with(0.1)

    def test_does_not_retry_business_error(self):
        operation = Mock(side_effect=ValueError("invalid"))
        with self.assertRaisesRegex(ValueError, "invalid"):
            retry_transport(operation)
        self.assertEqual(operation.call_count, 1)


if __name__ == "__main__":
    unittest.main()
