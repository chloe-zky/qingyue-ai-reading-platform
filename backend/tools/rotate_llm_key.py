#!/usr/bin/env python3
"""Create/rotate the local wrapping key and re-encrypt the stored AI API key.

The command intentionally prints status only. Neither the wrapping key nor the
AI credential is written to stdout, logs, command arguments, or Supabase SQL.
"""

from __future__ import annotations

import base64
import os
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = BACKEND_DIR / ".env"
ENV_NAME = "LLM_CONFIG_MASTER_KEYS"


def _read_env_value(path: Path, name: str) -> str:
    if not path.exists():
        return ""
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key, value = stripped.split("=", 1)
            if key.strip() == name:
                return value.strip().strip('"').strip("'")
    return ""


def _write_env_value(path: Path, name: str, value: str) -> None:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    replacement = f'{name}="{value}"'
    updated: list[str] = []
    replaced = False
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key == name:
                if not replaced:
                    updated.append(replacement)
                    replaced = True
                continue
        updated.append(line)
    if not replaced:
        if updated and updated[-1].strip():
            updated.append("")
        updated.append("# Backend-only AES-GCM wrapping key ring; never commit this file.")
        updated.append(replacement)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    temporary.write_text("\n".join(updated) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def _ensure_key_ring() -> tuple[str, bool]:
    existing = _read_env_value(ENV_PATH, ENV_NAME)
    if existing:
        return existing, False
    key_id = datetime.now(timezone.utc).strftime("local-%Y%m%d")
    encoded = base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")
    value = f"{key_id}:{encoded}"
    _write_env_value(ENV_PATH, ENV_NAME, value)
    return value, True


def main() -> int:
    key_ring, created = _ensure_key_ring()
    os.environ[ENV_NAME] = key_ring
    sys.path.insert(0, str(BACKEND_DIR))
    from app.services.secret_service import rotate_llm_api_key_encryption

    status = rotate_llm_api_key_encryption()
    messages = {
        "not_configured": "AI 密钥尚未配置；本机加密主密钥已就绪。",
        "migrated": "旧版 AI 密钥已迁移为加密存储，并已完成解密校验。",
        "rotated": "AI 密钥已使用当前主密钥版本重新加密，并已完成校验。",
    }
    prefix = "已生成本机加密主密钥。" if created else "已使用现有本机密钥环。"
    print(f"{prefix}{messages[status]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
