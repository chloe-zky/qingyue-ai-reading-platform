import time
from typing import Optional

import httpx

from app.database import supabase
from app.services.secret_service import get_llm_api_key, store_llm_api_key
from app.utils.outbound_url import validate_llm_api_base


class LLMConnectionTestError(RuntimeError):
    pass

def get_config_value(key: str) -> str:
    res = supabase.table("system_configs").select("config_value").eq("config_key", key).execute()
    if res.data and res.data[0].get('config_value'):
        return res.data[0]['config_value'].strip()
    return ""

def update_config_value(key: str, value: str, desc: str = "") -> None:
    supabase.table("system_configs").upsert({
        "config_key": key,
        "config_value": value.strip(),
        "config_desc": desc
    }, on_conflict="config_key").execute()

def _int_config(key: str, default: int) -> int:
    try:
        return int(get_config_value(key))
    except (TypeError, ValueError):
        return default


def _bounded_int_config(key: str, default: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, _int_config(key, default)))


def update_llm_config(
    api_base: str,
    api_key: Optional[str],
    model_name: str,
    api_type: str = "openai_compatible",
    timeout_seconds: Optional[int] = None,
    max_retries: Optional[int] = None,
) -> None:
    api_base = validate_llm_api_base(api_base)
    existing_key = get_llm_api_key()
    if not api_key and not existing_key:
        raise ValueError("首次配置 AI 服务时必须填写 API Key")

    update_config_value("llm_api_base", api_base, "OpenAI compatible API Base URL")
    if api_key:
        store_llm_api_key(api_key)
    update_config_value("llm_model_name", model_name, "当前使用的模型名称")
    update_config_value("llm_api_type", api_type, "API 类型")
    if timeout_seconds is not None:
        update_config_value("llm_timeout_seconds", str(timeout_seconds), "AI 请求超时秒数")
    if max_retries is not None:
        update_config_value("llm_max_retries", str(max_retries), "AI 请求最大重试次数")

def get_llm_config_status() -> dict:
    api_base = get_config_value("llm_api_base")
    api_key = get_llm_api_key()
    model_name = get_config_value("llm_model_name")
    api_type = get_config_value("llm_api_type")
    
    configured = bool(api_base and api_key and model_name)
    
    return {
        "configured": configured,
        "api_base": api_base,
        "model_name": model_name,
        "api_type": api_type,
        "masked_key": "***",
        "timeout_seconds": _bounded_int_config("llm_timeout_seconds", 30, 1, 300),
        "max_retries": _bounded_int_config("llm_max_retries", 2, 0, 10),
    }

def get_active_llm_config() -> dict:
    return {
        "api_base": get_config_value("llm_api_base"),
        "api_key": get_llm_api_key(),
        "model_name": get_config_value("llm_model_name"),
        "api_type": get_config_value("llm_api_type"),
        "timeout_seconds": _bounded_int_config("llm_timeout_seconds", 30, 1, 300),
        "max_retries": _bounded_int_config("llm_max_retries", 2, 0, 10),
    }


def _safe_llm_test_error(error: Exception) -> str:
    if isinstance(error, httpx.HTTPStatusError):
        status = error.response.status_code
        if status in {401, 403}:
            return "上游拒绝鉴权，请检查 API Key。"
        if status == 404:
            return "上游未找到接口或模型，请检查 API Base 与模型名称。"
        if status == 429:
            return "上游请求过于频繁或额度不足，请稍后重试。"
        if status >= 500:
            return f"上游服务暂时异常（HTTP {status}）。"
        return f"上游返回异常状态（HTTP {status}）。"
    if isinstance(error, httpx.TimeoutException):
        return "连接上游模型超时，请检查网络或增加超时时间。"
    if isinstance(error, httpx.NetworkError):
        return "无法连接上游模型，请检查 API Base 与本机网络。"
    return "上游响应格式不符合 OpenAI-compatible 规范。"


def list_available_llm_models(
    *,
    api_base: str,
    api_key: Optional[str],
    api_type: str = "openai_compatible",
    timeout_seconds: int = 20,
) -> dict:
    """Fetch canonical Gemini model IDs without returning credentials or raw payloads."""
    resolved_key = (api_key or get_llm_api_key()).strip()
    if not resolved_key:
        raise ValueError("拉取模型列表需要 API Key；首次配置请先填写密钥。")
    if api_type != "openai_compatible":
        raise ValueError("当前仅支持 OpenAI-compatible 接口。")
    api_base = validate_llm_api_base(api_base)

    try:
        with httpx.Client(timeout=float(timeout_seconds)) as client:
            response = client.get(
                f"{api_base.rstrip('/')}/models",
                headers={"Authorization": f"Bearer {resolved_key}"},
            )
            response.raise_for_status()
            data = response.json()
            records = data["data"]
            if not isinstance(records, list):
                raise ValueError("invalid model list")
            models = sorted({
                model_id
                for item in records
                if isinstance(item, dict)
                and isinstance((model_id := item.get("id")), str)
                and model_id.startswith("gemini-")
                and 1 <= len(model_id) <= 120
            })
            if not models:
                raise ValueError("empty model list")
    except Exception as error:
        raise LLMConnectionTestError(_safe_llm_test_error(error)) from error

    return {"models": models, "count": len(models)}


def test_llm_connection(
    *,
    api_base: str,
    api_key: Optional[str],
    model_name: str,
    api_type: str = "openai_compatible",
    timeout_seconds: int = 30,
) -> dict:
    """Run a fixed, content-free probe without persisting any supplied value."""
    resolved_key = (api_key or get_llm_api_key()).strip()
    if not resolved_key:
        raise ValueError("测试连接需要 API Key；首次配置请先在页面填写。")
    if api_type != "openai_compatible":
        raise ValueError("当前仅支持 OpenAI-compatible 接口。")
    api_base = validate_llm_api_base(api_base)

    url = f"{api_base.rstrip('/')}/chat/completions"
    payload = {
        "model": model_name,
        "messages": [
            {
                "role": "system",
                "content": "You are a connectivity probe. Do not request or infer user data.",
            },
            {
                "role": "user",
                "content": 'Return exactly this JSON object: {"ok":true}',
            },
        ],
        "temperature": 0,
        # Newer reasoning-capable Flash models may spend the first few dozen
        # tokens before emitting visible content; 20 could yield a false failure.
        "max_tokens": 256,
    }
    started = time.perf_counter()
    try:
        with httpx.Client(timeout=float(timeout_seconds)) as client:
            response = client.post(
                url,
                headers={
                    "Authorization": f"Bearer {resolved_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            if not isinstance(content, str) or not content.strip():
                raise ValueError("empty response")
    except Exception as error:
        raise LLMConnectionTestError(_safe_llm_test_error(error)) from error

    return {
        "status": "ok",
        "model_name": model_name,
        "latency_ms": max(0, round((time.perf_counter() - started) * 1000)),
        "message": "AI 服务连接成功。探测请求未包含任何稿件或用户内容。",
    }
