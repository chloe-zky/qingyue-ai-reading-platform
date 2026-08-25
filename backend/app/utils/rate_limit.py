from __future__ import annotations

from collections import OrderedDict, deque
from dataclasses import dataclass
from threading import Lock
import time


@dataclass(frozen=True)
class RateRule:
    name: str
    limit: int
    window_seconds: int


PUBLIC_RATE_RULES = {
    ("POST", "/api/author/articles"): RateRule("author.submit", 5, 60),
    ("POST", "/api/author/manuscript-text"): RateRule("author.docx", 10, 60),
    ("POST", "/api/author/article-statuses"): RateRule("author.status", 30, 60),
    ("POST", "/api/recommendations"): RateRule("recommendations", 60, 60),
    ("POST", "/api/feedback"): RateRule("feedback", 30, 60),
}


class SlidingWindowLimiter:
    """Small per-process fallback; the deployment gateway remains the first layer."""

    def __init__(self, max_buckets: int = 10_000):
        self.max_buckets = max_buckets
        self._hits: OrderedDict[tuple[str, str], deque[float]] = OrderedDict()
        self._lock = Lock()

    def check(self, rule: RateRule, identity: str, now: float | None = None) -> tuple[bool, int]:
        timestamp = time.monotonic() if now is None else now
        cutoff = timestamp - rule.window_seconds
        bucket_key = (rule.name, identity)
        with self._lock:
            bucket = self._hits.pop(bucket_key, deque())
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= rule.limit:
                retry_after = max(1, round(bucket[0] + rule.window_seconds - timestamp))
                self._hits[bucket_key] = bucket
                return False, retry_after
            bucket.append(timestamp)
            self._hits[bucket_key] = bucket
            while len(self._hits) > self.max_buckets:
                self._hits.popitem(last=False)
        return True, 0


public_rate_limiter = SlidingWindowLimiter()
