from __future__ import annotations

import base64
import logging
import os
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import LLM_CONFIG_MASTER_KEYS
from app.database import supabase


logger = logging.getLogger(__name__)
ENVELOPE_PREFIX = "enc:v1"
SECRET_NAME = "llm_api_key"


class SecretConfigurationError(RuntimeError):
    pass


class SecretDecryptionError(RuntimeError):
    pass


@dataclass(frozen=True)
class MasterKey:
    key_id: str
    value: bytes


def _decode_key(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        decoded = base64.urlsafe_b64decode(value + padding)
    except (ValueError, TypeError) as error:
        raise SecretConfigurationError("AI 配置主密钥不是有效的 Base64URL") from error
    if len(decoded) != 32:
        raise SecretConfigurationError("AI 配置主密钥解码后必须为 32 字节")
    return decoded


def parse_master_keys(raw: str | None = None) -> tuple[MasterKey, ...]:
    keys: list[MasterKey] = []
    seen: set[str] = set()
    for item in (LLM_CONFIG_MASTER_KEYS if raw is None else raw).split(","):
        item = item.strip()
        if not item:
            continue
        key_id, separator, encoded = item.partition(":")
        key_id = key_id.strip()
        if not separator or not key_id or len(key_id) > 40:
            raise SecretConfigurationError("AI 配置主密钥格式应为 key-id:base64url-key")
        if key_id in seen:
            raise SecretConfigurationError("AI 配置主密钥 key-id 不能重复")
        if not all(character.isalnum() or character in "_-" for character in key_id):
            raise SecretConfigurationError("AI 配置主密钥 key-id 只允许字母、数字、_ 和 -")
        keys.append(MasterKey(key_id, _decode_key(encoded.strip())))
        seen.add(key_id)
    if not keys:
        raise SecretConfigurationError("缺少 LLM_CONFIG_MASTER_KEYS，无法安全保存 AI 密钥")
    return tuple(keys)


def encrypt_secret(plaintext: str, raw_keys: str | None = None) -> dict[str, str]:
    value = plaintext.strip()
    if not value:
        raise ValueError("不能加密空密钥")
    active = parse_master_keys(raw_keys)[0]
    nonce = os.urandom(12)
    aad = f"{SECRET_NAME}:{active.key_id}".encode()
    ciphertext = AESGCM(active.value).encrypt(nonce, value.encode(), aad)
    encoded_nonce = base64.urlsafe_b64encode(nonce).decode().rstrip("=")
    encoded_ciphertext = base64.urlsafe_b64encode(ciphertext).decode().rstrip("=")
    return {
        "ciphertext": f"{ENVELOPE_PREFIX}:{active.key_id}:{encoded_nonce}:{encoded_ciphertext}",
        "key_id": active.key_id,
        "algorithm": "AES-256-GCM",
    }


def decrypt_secret(envelope: str, raw_keys: str | None = None) -> str:
    parts = envelope.split(":")
    if len(parts) != 5 or ":".join(parts[:2]) != ENVELOPE_PREFIX:
        raise SecretDecryptionError("AI 密钥密文格式无效")
    key_id, encoded_nonce, encoded_ciphertext = parts[2], parts[3], parts[4]
    keys = {item.key_id: item.value for item in parse_master_keys(raw_keys)}
    key = keys.get(key_id)
    if key is None:
        raise SecretDecryptionError(f"缺少用于解密 AI 配置的主密钥版本：{key_id}")
    try:
        nonce = base64.urlsafe_b64decode(encoded_nonce + "=" * (-len(encoded_nonce) % 4))
        ciphertext = base64.urlsafe_b64decode(
            encoded_ciphertext + "=" * (-len(encoded_ciphertext) % 4)
        )
        plaintext = AESGCM(key).decrypt(
            nonce,
            ciphertext,
            f"{SECRET_NAME}:{key_id}".encode(),
        )
    except Exception as error:
        raise SecretDecryptionError("AI 密钥解密失败，请检查主密钥版本") from error
    return plaintext.decode()


def _encrypted_secret_row() -> dict | None:
    rows = (
        supabase.table("system_config_secrets")
        .select("ciphertext,key_id,algorithm")
        .eq("config_key", SECRET_NAME)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def get_legacy_llm_api_key() -> str:
    rows = (
        supabase.table("system_configs")
        .select("config_value")
        .eq("config_key", SECRET_NAME)
        .limit(1)
        .execute()
        .data
        or []
    )
    return str(rows[0].get("config_value") or "").strip() if rows else ""


def get_llm_api_key() -> str:
    row = _encrypted_secret_row()
    if row:
        return decrypt_secret(str(row["ciphertext"]))
    legacy = get_legacy_llm_api_key()
    if legacy:
        logger.warning("检测到旧版明文 AI 密钥；请立即运行 rotate_llm_key.py")
    return legacy


def store_llm_api_key(api_key: str) -> None:
    encrypted = encrypt_secret(api_key)
    supabase.rpc(
        "store_encrypted_system_secret",
        {
            "p_config_key": SECRET_NAME,
            "p_ciphertext": encrypted["ciphertext"],
            "p_key_id": encrypted["key_id"],
            "p_algorithm": encrypted["algorithm"],
        },
    ).execute()


def rotate_llm_api_key_encryption() -> str:
    row = _encrypted_secret_row()
    plaintext = decrypt_secret(str(row["ciphertext"])) if row else get_legacy_llm_api_key()
    if not plaintext:
        return "not_configured"
    store_llm_api_key(plaintext)
    verified = get_llm_api_key()
    if verified != plaintext:
        raise SecretDecryptionError("AI 密钥轮换后校验失败")
    return "rotated" if row else "migrated"
