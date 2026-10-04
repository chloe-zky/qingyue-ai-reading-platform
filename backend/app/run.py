from __future__ import annotations

import os

import uvicorn


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} 必须是整数") from exc
    if value < 1:
        raise ValueError(f"{name} 必须至少为 1")
    return value


def main() -> None:
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=_positive_int("PORT", 8000),
        workers=_positive_int("WEB_CONCURRENCY", 2),
        proxy_headers=True,
        forwarded_allow_ips=os.getenv("FORWARDED_ALLOW_IPS", "127.0.0.1"),
    )


if __name__ == "__main__":
    main()
