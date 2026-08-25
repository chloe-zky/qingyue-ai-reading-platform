from __future__ import annotations

import time
from typing import Callable, TypeVar

import httpx


T = TypeVar("T")


def retry_transport(operation: Callable[[], T], *, attempts: int = 2) -> T:
    """Retry only short-lived network transport failures, never business errors."""
    if attempts < 1:
        raise ValueError("attempts 必须至少为 1")
    for attempt in range(attempts):
        try:
            return operation()
        except httpx.TransportError:
            if attempt + 1 >= attempts:
                raise
            time.sleep(0.1 * (attempt + 1))
    raise RuntimeError("unreachable")
