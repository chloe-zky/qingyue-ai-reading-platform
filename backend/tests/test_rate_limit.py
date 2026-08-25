import unittest

from app.utils.rate_limit import RateRule, SlidingWindowLimiter


class SlidingWindowLimiterTests(unittest.TestCase):
    def test_rejects_after_limit_and_recovers_after_window(self):
        limiter = SlidingWindowLimiter()
        rule = RateRule("test", 2, 10)

        self.assertEqual(limiter.check(rule, "reader", now=0), (True, 0))
        self.assertEqual(limiter.check(rule, "reader", now=1), (True, 0))
        allowed, retry_after = limiter.check(rule, "reader", now=2)
        self.assertFalse(allowed)
        self.assertEqual(retry_after, 8)
        self.assertEqual(limiter.check(rule, "reader", now=11), (True, 0))

    def test_keeps_identities_isolated(self):
        limiter = SlidingWindowLimiter()
        rule = RateRule("test", 1, 60)

        self.assertEqual(limiter.check(rule, "one", now=0), (True, 0))
        self.assertEqual(limiter.check(rule, "two", now=0), (True, 0))


if __name__ == "__main__":
    unittest.main()
