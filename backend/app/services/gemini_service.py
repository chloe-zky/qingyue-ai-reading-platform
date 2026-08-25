import time

import httpx

from app.database import supabase
from app.services.admin_service import get_active_llm_config
from app.services.tag_service import filter_tags, get_valid_vocabularies
from app.utils.json_utils import clean_and_parse_json
from app.utils.outbound_url import validate_llm_api_base


RETRYABLE_STATUS_CODES = {408, 425, 429, 500, 502, 503, 504}


def _render_prompt_template(template: str, values: dict[str, str]) -> str:
    rendered = template
    for name in ("title", "intro", "sample"):
        rendered = rendered.replace(f"{{{{{name}}}}}", values.get(name, ""))
    return rendered


def get_published_tagging_prompt(book: dict) -> tuple[str, str]:
    """Read the canonical published Prompt, with the legacy table as fallback."""
    prompt_rows = (
        supabase.table("editorial_prompts")
        .select("id")
        .eq("prompt_key", "novel_metadata_tagging")
        .eq("status", "active")
        .limit(1)
        .execute()
        .data
        or []
    )
    if prompt_rows:
        versions = (
            supabase.table("editorial_prompt_versions")
            .select(
                "version_no,system_prompt,user_prompt_template,variables"
            )
            .eq("prompt_id", prompt_rows[0]["id"])
            .eq("status", "published")
            .limit(1)
            .execute()
            .data
            or []
        )
        if versions:
            version = versions[0]
            values = {
                "title": str(book.get("title") or ""),
                "intro": str(book.get("intro") or ""),
                "sample": str(book.get("sample") or ""),
            }
            body = _render_prompt_template(
                version.get("user_prompt_template") or "", values
            )
            prompt = f"{version.get('system_prompt') or ''}\n\n{body}".strip()
            return prompt, f"editorial-v{version['version_no']}"

    legacy = (
        supabase.table("prompt_versions")
        .select("prompt_text,version")
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not legacy:
        raise ValueError("找不到已发布的提示词 (Prompt)")
    prompt_text = legacy[0]["prompt_text"]
    prompt = (
        f"{prompt_text}\n\n"
        f"标题：《{book.get('title') or ''}》\n"
        f"扉页语：{book.get('intro') or ''}\n"
        f"内容简介：{book.get('sample') or ''}\n\n"
        "提示：请严格输出 JSON，不要输出 markdown，不要解释。"
    )
    return prompt, legacy[0]["version"]


def _is_retryable(error: Exception) -> bool:
    if isinstance(error, (httpx.TimeoutException, httpx.NetworkError)):
        return True
    if isinstance(error, httpx.HTTPStatusError):
        return error.response.status_code in RETRYABLE_STATUS_CODES
    return False


def call_openai_compatible_llm(
    api_base: str,
    api_key: str,
    model_name: str,
    prompt: str,
    *,
    timeout_seconds: int = 30,
    max_retries: int = 2,
) -> str:
    api_base = validate_llm_api_base(api_base)
    url = f"{api_base.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model_name,
        "messages": [
            {
                "role": "system",
                "content": "你是一个严格输出 JSON 的内容理解助手。不要输出 markdown，不要解释。",
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
    }

    with httpx.Client(timeout=float(timeout_seconds)) as client:
        for attempt in range(max_retries + 1):
            try:
                response = client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
                return data["choices"][0]["message"]["content"]
            except Exception as error:
                if attempt >= max_retries or not _is_retryable(error):
                    raise
                time.sleep(min(0.25 * (2 ** attempt), 1.0))

    raise RuntimeError("LLM 请求未返回结果")


def extract_tags_for_book(book_id: int, auto_confirm: bool = False) -> dict:
    llm_config = get_active_llm_config()
    api_base = llm_config["api_base"]
    api_key = llm_config["api_key"]
    model_name = llm_config["model_name"]
    api_type = llm_config["api_type"]
    timeout_seconds = llm_config["timeout_seconds"]
    max_retries = llm_config["max_retries"]

    if not api_base or not api_key or not model_name:
        raise ValueError("系统未配置完整 LLM 信息，请先在管理员入口填写。")
    if api_type != "openai_compatible":
        raise ValueError(f"暂不支持的 api_type: {api_type}")

    # AI 打标只读取标题、扉页语和内容简介；作者正文与编辑配图绝不发送给 LLM。
    book_res = (
        supabase.table("books")
        .select("title, intro, sample")
        .eq("id", book_id)
        .execute()
    )
    if not book_res.data:
        raise ValueError(f"找不到 ID 为 {book_id} 的书籍")
    book = book_res.data[0]

    full_prompt, prompt_version = get_published_tagging_prompt(book)

    try:
        raw_response_text = call_openai_compatible_llm(
            api_base,
            api_key,
            model_name,
            full_prompt,
            timeout_seconds=timeout_seconds,
            max_retries=max_retries,
        )
        parsed_json = clean_and_parse_json(raw_response_text)
    except Exception as error:
        raise RuntimeError(f"代理模型调用或响应解析失败: {error}") from error

    filtered_tags = filter_tags(parsed_json, get_valid_vocabularies())
    tag_status = "confirmed" if auto_confirm else "draft"
    supabase.table("book_ai_tags").upsert(
        {
            "book_id": book_id,
            **filtered_tags,
            "tag_source": "ai",
            "tag_status": tag_status,
            "raw_response": parsed_json,
            "llm_provider": "openai_compatible_proxy",
            "model_name": model_name,
            "prompt_version": prompt_version,
        },
        on_conflict="book_id",
    ).execute()

    return filtered_tags
