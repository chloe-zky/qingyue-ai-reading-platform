from typing import Optional

from app.database import supabase

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
    existing_key = get_config_value("llm_api_key")
    if not api_key and not existing_key:
        raise ValueError("首次配置 AI 服务时必须填写 API Key")

    update_config_value("llm_api_base", api_base, "OpenAI compatible API Base URL")
    if api_key:
        update_config_value("llm_api_key", api_key, "OpenAI compatible API Key")
    update_config_value("llm_model_name", model_name, "当前使用的模型名称")
    update_config_value("llm_api_type", api_type, "API 类型")
    if timeout_seconds is not None:
        update_config_value("llm_timeout_seconds", str(timeout_seconds), "AI 请求超时秒数")
    if max_retries is not None:
        update_config_value("llm_max_retries", str(max_retries), "AI 请求最大重试次数")

def get_llm_config_status() -> dict:
    api_base = get_config_value("llm_api_base")
    api_key = get_config_value("llm_api_key")
    model_name = get_config_value("llm_model_name")
    api_type = get_config_value("llm_api_type")
    
    configured = bool(api_base and api_key and model_name)
    
    masked_key = "***"
    if api_key:
        masked_key = api_key[:4] + "****" + api_key[-4:] if len(api_key) > 8 else "***"
        
    return {
        "configured": configured,
        "api_base": api_base,
        "model_name": model_name,
        "api_type": api_type,
        "masked_key": masked_key,
        "timeout_seconds": _bounded_int_config("llm_timeout_seconds", 30, 1, 300),
        "max_retries": _bounded_int_config("llm_max_retries", 2, 0, 10),
    }

def get_active_llm_config() -> dict:
    return {
        "api_base": get_config_value("llm_api_base"),
        "api_key": get_config_value("llm_api_key"),
        "model_name": get_config_value("llm_model_name"),
        "api_type": get_config_value("llm_api_type"),
        "timeout_seconds": _bounded_int_config("llm_timeout_seconds", 30, 1, 300),
        "max_retries": _bounded_int_config("llm_max_retries", 2, 0, 10),
    }
