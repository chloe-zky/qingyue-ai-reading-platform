from __future__ import annotations

import re
import uuid

from app.database import supabase
from app.schemas.editorial import (
    PromptDraftRequest,
    PromptTestRequest,
    RollbackVersionRequest,
    StrategySimulationRequest,
    StrategyDraftRequest,
    VocabularyTermCreateRequest,
    VocabularyTermUpdateRequest,
)
from app.services.admin_service import get_active_llm_config
from app.services.audit_service import write_audit_log
from app.services.gemini_service import (
    _render_prompt_template,
    call_openai_compatible_llm,
)
from app.services.tag_service import filter_tags, get_valid_vocabularies
from app.utils.json_utils import clean_and_parse_json
from app.utils.auth import StaffPrincipal


class EditorialConfigNotFoundError(ValueError):
    pass


class EditorialConfigConflictError(ValueError):
    pass


_PROMPT_VARIABLE_PATTERN = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")
_ALLOWED_PROMPT_VARIABLES = {"title", "intro", "sample"}


def _latest_version(rows: list[dict], status: str) -> int | None:
    numbers = [
        int(row["version_no"])
        for row in rows
        if row.get("status") == status and row.get("version_no") is not None
    ]
    return max(numbers) if numbers else None


def _latest_published_at(groups: list[list[dict]]):
    values = [
        row.get("published_at")
        for rows in groups
        for row in rows
        if row.get("published_at")
    ]
    return max(values) if values else None


def get_editorial_overview() -> dict:
    prompt_versions = (
        supabase.table("editorial_prompt_versions")
        .select("version_no,status,published_at")
        .execute()
        .data
        or []
    )
    vocabulary_versions = (
        supabase.table("tag_vocabulary_versions")
        .select("version_no,status,published_at")
        .execute()
        .data
        or []
    )
    strategy_versions = (
        supabase.table("editorial_strategy_versions")
        .select("version_no,status,published_at")
        .execute()
        .data
        or []
    )
    all_versions = [prompt_versions, vocabulary_versions, strategy_versions]
    return {
        "prompt_version": _latest_version(prompt_versions, "published"),
        "tag_vocabulary_version": _latest_version(
            vocabulary_versions, "published"
        ),
        "strategy_version": _latest_version(strategy_versions, "published"),
        "draft_count": sum(
            1
            for rows in all_versions
            for row in rows
            if row.get("status") == "draft"
        ),
        "last_published_at": _latest_published_at(all_versions),
    }


def list_editorial_prompts() -> list[dict]:
    prompts = (
        supabase.table("editorial_prompts")
        .select("id,prompt_key,name,use_case,description,status,updated_at")
        .order("updated_at", desc=True)
        .execute()
        .data
        or []
    )
    prompt_ids = [row["id"] for row in prompts]
    versions_by_prompt: dict[str, list[dict]] = {}
    if prompt_ids:
        versions = (
            supabase.table("editorial_prompt_versions")
            .select("prompt_id,version_no,status")
            .in_("prompt_id", prompt_ids)
            .execute()
            .data
            or []
        )
        for version in versions:
            versions_by_prompt.setdefault(str(version["prompt_id"]), []).append(version)

    return [
        {
            **prompt,
            "id": str(prompt["id"]),
            "published_version": _latest_version(
                versions_by_prompt.get(str(prompt["id"]), []), "published"
            ),
            "latest_draft_version": _latest_version(
                versions_by_prompt.get(str(prompt["id"]), []), "draft"
            ),
        }
        for prompt in prompts
    ]


def list_vocabulary_versions() -> list[dict]:
    versions = (
        supabase.table("tag_vocabulary_versions")
        .select("id,version_no,status,change_note,created_at,published_at")
        .order("version_no", desc=True)
        .execute()
        .data
        or []
    )
    version_ids = [row["id"] for row in versions]
    counts: dict[str, int] = {}
    if version_ids:
        categories = (
            supabase.table("tag_categories")
            .select("vocabulary_version_id")
            .in_("vocabulary_version_id", version_ids)
            .execute()
            .data
            or []
        )
        for category in categories:
            key = str(category["vocabulary_version_id"])
            counts[key] = counts.get(key, 0) + 1

    return [
        {
            **version,
            "id": str(version["id"]),
            "category_count": counts.get(str(version["id"]), 0),
        }
        for version in versions
    ]


def list_editorial_strategies() -> list[dict]:
    strategies = (
        supabase.table("editorial_strategies")
        .select("id,strategy_key,name,use_case,description,status,updated_at")
        .order("updated_at", desc=True)
        .execute()
        .data
        or []
    )
    strategy_ids = [row["id"] for row in strategies]
    versions_by_strategy: dict[str, list[dict]] = {}
    if strategy_ids:
        versions = (
            supabase.table("editorial_strategy_versions")
            .select("strategy_id,version_no,status")
            .in_("strategy_id", strategy_ids)
            .execute()
            .data
            or []
        )
        for version in versions:
            versions_by_strategy.setdefault(
                str(version["strategy_id"]), []
            ).append(version)

    return [
        {
            **strategy,
            "id": str(strategy["id"]),
            "published_version": _latest_version(
                versions_by_strategy.get(str(strategy["id"]), []), "published"
            ),
            "latest_draft_version": _latest_version(
                versions_by_strategy.get(str(strategy["id"]), []), "draft"
            ),
        }
        for strategy in strategies
    ]


def _single_row(table: str, row_id: str, columns: str = "*") -> dict:
    response = (
        supabase.table(table)
        .select(columns)
        .eq("id", row_id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    if not rows:
        raise EditorialConfigNotFoundError("找不到指定的编辑配置")
    return rows[0]


def _version_numbers(rows: list[dict]) -> list[int]:
    return [int(row["version_no"]) for row in rows if row.get("version_no")]


def _mutation_result(data, default_status: str) -> dict:
    value = data
    if isinstance(value, list):
        value = value[0] if value else None
    if not isinstance(value, dict) or value.get("version_no") is None:
        raise RuntimeError("数据库没有返回配置版本结果")
    return {
        "version_no": int(value["version_no"]),
        "status": value.get("status") or default_status,
    }


def get_editorial_prompt(prompt_id: str) -> dict:
    prompt = _single_row(
        "editorial_prompts",
        prompt_id,
        "id,prompt_key,name,use_case,description,status,updated_at",
    )
    versions = (
        supabase.table("editorial_prompt_versions")
        .select(
            "id,prompt_id,version_no,status,system_prompt,user_prompt_template,"
            "variables,change_note,created_at,published_at"
        )
        .eq("prompt_id", prompt_id)
        .order("version_no", desc=True)
        .execute()
        .data
        or []
    )
    return {
        **prompt,
        "id": str(prompt["id"]),
        "published_version": _latest_version(versions, "published"),
        "latest_draft_version": _latest_version(versions, "draft"),
        "versions": [{**row, "id": str(row["id"])} for row in versions],
    }


def _validate_prompt_template(request: PromptDraftRequest) -> None:
    found = set(
        _PROMPT_VARIABLE_PATTERN.findall(
            f"{request.system_prompt}\n{request.user_prompt_template}"
        )
    )
    unsupported = found - _ALLOWED_PROMPT_VARIABLES
    if unsupported:
        names = "、".join(sorted(unsupported))
        raise EditorialConfigConflictError(
            f"Prompt 包含不允许的变量：{names}；不得传入正文或作者隐私字段"
        )
    if found != set(request.variables):
        raise EditorialConfigConflictError(
            "variables 必须与模板中实际使用的变量完全一致"
        )


def save_prompt_draft(
    prompt_id: str,
    request: PromptDraftRequest,
    principal: StaffPrincipal,
) -> dict:
    _validate_prompt_template(request)
    detail = get_editorial_prompt(prompt_id)
    versions = detail["versions"]
    draft = next((row for row in versions if row.get("status") == "draft"), None)
    published = next(
        (row for row in versions if row.get("status") == "published"), None
    )
    current_version = int(
        (draft or published or {"version_no": 0})["version_no"]
    )
    if (
        request.expected_version_no is not None
        and request.expected_version_no != current_version
    ):
        raise EditorialConfigConflictError("配置版本已变化，请刷新后重新编辑")

    metadata = {
        "name": request.name,
        "description": request.description,
    }
    supabase.table("editorial_prompts").update(metadata).eq(
        "id", prompt_id
    ).execute()

    payload = {
        "system_prompt": request.system_prompt,
        "user_prompt_template": request.user_prompt_template,
        "variables": request.variables,
        "change_note": request.change_note,
    }
    if draft:
        response = (
            supabase.table("editorial_prompt_versions")
            .update(payload)
            .eq("id", draft["id"])
            .eq("status", "draft")
            .execute()
        )
        if not response.data:
            raise EditorialConfigConflictError("Prompt 草稿已变化，请刷新后重试")
        version_no = int(draft["version_no"])
    else:
        version_no = max(_version_numbers(versions), default=0) + 1
        payload.update(
            {
                "prompt_id": prompt_id,
                "version_no": version_no,
                "status": "draft",
                "created_by": principal.user_id,
            }
        )
        supabase.table("editorial_prompt_versions").insert(payload).execute()

    write_audit_log(
        principal,
        domain="editorial",
        action="prompt.draft.save",
        resource_type="editorial_prompt",
        resource_id=f"{detail['prompt_key']}:v{version_no}",
        summary="保存 Prompt 草稿",
        after_data={"version": version_no, "variables": request.variables},
    )
    return {"message": "Prompt 草稿已保存。", "version_no": version_no, "status": "draft"}


def publish_prompt_version(
    prompt_id: str, version_no: int, principal: StaffPrincipal
) -> dict:
    get_editorial_prompt(prompt_id)
    response = supabase.rpc(
        "publish_editorial_prompt_version",
        {
            "p_prompt_id": prompt_id,
            "p_version_no": version_no,
            "p_actor": principal.user_id,
        },
    ).execute()
    result = _mutation_result(response.data, "published")
    write_audit_log(
        principal,
        domain="editorial",
        action="prompt.publish",
        resource_type="editorial_prompt",
        resource_id=f"{prompt_id}:v{result['version_no']}",
        summary="发布 Prompt 版本",
        after_data={"version": result["version_no"]},
    )
    return {"message": "Prompt 版本已发布。", **result}


def rollback_prompt_version(
    prompt_id: str,
    request: RollbackVersionRequest,
    principal: StaffPrincipal,
) -> dict:
    get_editorial_prompt(prompt_id)
    response = supabase.rpc(
        "rollback_editorial_prompt_version",
        {
            "p_prompt_id": prompt_id,
            "p_target_version_no": request.target_version_no,
            "p_change_note": request.change_note,
            "p_actor": principal.user_id,
        },
    ).execute()
    result = _mutation_result(response.data, "published")
    write_audit_log(
        principal,
        domain="editorial",
        action="prompt.rollback",
        resource_type="editorial_prompt",
        resource_id=f"{prompt_id}:v{result['version_no']}",
        summary=f"回滚 Prompt 至 v{request.target_version_no} 的内容",
        before_data={"target_version": request.target_version_no},
        after_data={"version": result["version_no"]},
    )
    return {"message": "Prompt 已按历史版本内容重新发布。", **result}


def test_prompt_draft(
    prompt_id: str,
    request: PromptTestRequest,
    principal: StaffPrincipal,
) -> dict:
    detail = get_editorial_prompt(prompt_id)
    validation_request = PromptDraftRequest(
        name=detail["name"],
        description=detail.get("description") or "",
        system_prompt=request.system_prompt,
        user_prompt_template=request.user_prompt_template,
        variables=request.variables,
    )
    _validate_prompt_template(validation_request)

    llm_config = get_active_llm_config()
    if llm_config.get("api_type") != "openai_compatible":
        raise EditorialConfigConflictError("当前 AI 服务类型不支持 Prompt 试运行")
    if not all(
        llm_config.get(field) for field in ("api_base", "api_key", "model_name")
    ):
        raise EditorialConfigConflictError("AI 服务配置不完整，无法试运行")

    rendered = _render_prompt_template(
        request.user_prompt_template,
        {"title": request.title, "intro": request.intro, "sample": request.sample},
    )
    prompt = f"{request.system_prompt}\n\n{rendered}".strip()
    raw = call_openai_compatible_llm(
        llm_config["api_base"],
        llm_config["api_key"],
        llm_config["model_name"],
        prompt,
        timeout_seconds=llm_config["timeout_seconds"],
        max_retries=llm_config["max_retries"],
    )
    parsed = clean_and_parse_json(raw)
    output = filter_tags(parsed, get_valid_vocabularies())
    write_audit_log(
        principal,
        domain="editorial",
        action="prompt.test",
        resource_type="editorial_prompt",
        resource_id=detail["prompt_key"],
        summary="试运行 Prompt（仅元数据输入）",
        after_data={"model_name": llm_config["model_name"]},
    )
    return {"output": output, "model_name": llm_config["model_name"]}


def get_editorial_strategy(strategy_id: str) -> dict:
    strategy = _single_row(
        "editorial_strategies",
        strategy_id,
        "id,strategy_key,name,use_case,description,status,updated_at",
    )
    versions = (
        supabase.table("editorial_strategy_versions")
        .select(
            "id,strategy_id,version_no,status,settings,change_note,"
            "created_at,published_at"
        )
        .eq("strategy_id", strategy_id)
        .order("version_no", desc=True)
        .execute()
        .data
        or []
    )
    return {
        **strategy,
        "id": str(strategy["id"]),
        "published_version": _latest_version(versions, "published"),
        "latest_draft_version": _latest_version(versions, "draft"),
        "versions": [{**row, "id": str(row["id"])} for row in versions],
    }


def _strategy_settings(request: StrategyDraftRequest) -> dict:
    return {
        "algorithm": "weighted_tag_match_v1",
        "weights": {
            "setting": request.setting_weight,
            "story_tone": request.story_tone_weight,
            "relationship_core": request.relationship_core_weight,
        },
        "max_score": request.max_score,
        "result_limit": request.result_limit,
        "candidate_filter": {"book_status": "active", "tag_status": "confirmed"},
        "cold_start": {"mode": "latest_confirmed", "limit": 10},
        "tie_breakers": ["score_desc", "book_id_desc"],
        "behavior_learning_enabled": False,
    }


def save_strategy_draft(
    strategy_id: str,
    request: StrategyDraftRequest,
    principal: StaffPrincipal,
) -> dict:
    detail = get_editorial_strategy(strategy_id)
    versions = detail["versions"]
    draft = next((row for row in versions if row.get("status") == "draft"), None)
    published = next(
        (row for row in versions if row.get("status") == "published"), None
    )
    current_version = int(
        (draft or published or {"version_no": 0})["version_no"]
    )
    if (
        request.expected_version_no is not None
        and request.expected_version_no != current_version
    ):
        raise EditorialConfigConflictError("策略版本已变化，请刷新后重新编辑")

    supabase.table("editorial_strategies").update(
        {"name": request.name, "description": request.description}
    ).eq("id", strategy_id).execute()
    payload = {
        "settings": _strategy_settings(request),
        "change_note": request.change_note,
    }
    if draft:
        response = (
            supabase.table("editorial_strategy_versions")
            .update(payload)
            .eq("id", draft["id"])
            .eq("status", "draft")
            .execute()
        )
        if not response.data:
            raise EditorialConfigConflictError("策略草稿已变化，请刷新后重试")
        version_no = int(draft["version_no"])
    else:
        version_no = max(_version_numbers(versions), default=0) + 1
        payload.update(
            {
                "strategy_id": strategy_id,
                "version_no": version_no,
                "status": "draft",
                "created_by": principal.user_id,
            }
        )
        supabase.table("editorial_strategy_versions").insert(payload).execute()

    write_audit_log(
        principal,
        domain="editorial",
        action="strategy.draft.save",
        resource_type="editorial_strategy",
        resource_id=f"{detail['strategy_key']}:v{version_no}",
        summary="保存推荐策略草稿",
        after_data={"version": version_no, "weights": payload["settings"]["weights"]},
    )
    return {"message": "推荐策略草稿已保存。", "version_no": version_no, "status": "draft"}


def publish_strategy_version(
    strategy_id: str, version_no: int, principal: StaffPrincipal
) -> dict:
    get_editorial_strategy(strategy_id)
    response = supabase.rpc(
        "publish_editorial_strategy_version",
        {
            "p_strategy_id": strategy_id,
            "p_version_no": version_no,
            "p_actor": principal.user_id,
        },
    ).execute()
    result = _mutation_result(response.data, "published")
    write_audit_log(
        principal,
        domain="editorial",
        action="strategy.publish",
        resource_type="editorial_strategy",
        resource_id=f"{strategy_id}:v{result['version_no']}",
        summary="发布推荐策略版本",
        after_data={"version": result["version_no"]},
    )
    return {"message": "推荐策略版本已发布。", **result}


def rollback_strategy_version(
    strategy_id: str,
    request: RollbackVersionRequest,
    principal: StaffPrincipal,
) -> dict:
    get_editorial_strategy(strategy_id)
    response = supabase.rpc(
        "rollback_editorial_strategy_version",
        {
            "p_strategy_id": strategy_id,
            "p_target_version_no": request.target_version_no,
            "p_change_note": request.change_note,
            "p_actor": principal.user_id,
        },
    ).execute()
    result = _mutation_result(response.data, "published")
    write_audit_log(
        principal,
        domain="editorial",
        action="strategy.rollback",
        resource_type="editorial_strategy",
        resource_id=f"{strategy_id}:v{result['version_no']}",
        summary=f"回滚推荐策略至 v{request.target_version_no} 的内容",
        before_data={"target_version": request.target_version_no},
        after_data={"version": result["version_no"]},
    )
    return {"message": "推荐策略已按历史版本内容重新发布。", **result}


def simulate_strategy(
    strategy_id: str,
    request: StrategySimulationRequest,
    principal: StaffPrincipal,
) -> dict:
    detail = get_editorial_strategy(strategy_id)
    books = (
        supabase.table("books")
        .select("id,title,author")
        .eq("status", "active")
        .execute()
        .data
        or []
    )
    tags = (
        supabase.table("book_ai_tags")
        .select(
            "book_id,setting_tags,story_tone_tags,relationship_core_tags"
        )
        .eq("tag_status", "confirmed")
        .execute()
        .data
        or []
    )
    books_by_id = {row["id"]: row for row in books}
    results: list[dict] = []
    for tag_row in tags:
        book = books_by_id.get(tag_row["book_id"])
        if not book:
            continue
        selected_weight = 0.0
        score = 0.0
        matched = {"setting": [], "story_tone": [], "relationship": []}
        dimensions = (
            (
                "setting_tags",
                request.setting_tags,
                request.setting_weight,
                "setting",
            ),
            (
                "story_tone_tags",
                request.story_tone_tags,
                request.story_tone_weight,
                "story_tone",
            ),
            (
                "relationship_core_tags",
                request.relationship_core_tags,
                request.relationship_core_weight,
                "relationship",
            ),
        )
        for field, preferences, weight, output_key in dimensions:
            if not preferences:
                continue
            selected_weight += weight
            available = set(tag_row.get(field) or [])
            selected = [item for item in preferences if item in available]
            matched[output_key] = selected
            score += (len(selected) / len(preferences)) * weight
        final_score = (
            round((score / selected_weight) * request.max_score)
            if selected_weight > 0
            else 0
        )
        if final_score > 0:
            results.append(
                {
                    "book_id": int(book["id"]),
                    "title": book.get("title") or "未命名作品",
                    "author": book.get("author") or "匿名作者",
                    "score": min(final_score, request.max_score),
                    "matched_tags": matched,
                }
            )
    results.sort(key=lambda row: (row["score"], row["book_id"]), reverse=True)
    top_results = results[: request.result_limit]
    write_audit_log(
        principal,
        domain="editorial",
        action="strategy.simulate",
        resource_type="editorial_strategy",
        resource_id=detail["strategy_key"],
        summary="运行推荐策略模拟",
        after_data={
            "candidate_count": len(results),
            "result_count": len(top_results),
        },
    )
    return {"results": top_results, "candidate_count": len(results)}


def get_vocabulary_version(version_id: str) -> dict:
    version = _single_row(
        "tag_vocabulary_versions",
        version_id,
        "id,version_no,status,change_note,created_at,published_at",
    )
    categories = (
        supabase.table("tag_categories")
        .select("id,vocabulary_version_id,category_key,name,description,sort_order,status")
        .eq("vocabulary_version_id", version_id)
        .order("sort_order")
        .execute()
        .data
        or []
    )
    category_ids = [row["id"] for row in categories]
    terms = []
    if category_ids:
        terms = (
            supabase.table("tag_terms")
            .select("id,category_id,term_key,name,description,synonyms,sort_order,status")
            .in_("category_id", category_ids)
            .order("sort_order")
            .execute()
            .data
            or []
        )
    terms_by_category: dict[str, list[dict]] = {}
    for term in terms:
        terms_by_category.setdefault(str(term["category_id"]), []).append(
            {**term, "id": str(term["id"])}
        )
    category_rows = [
        {
            **category,
            "id": str(category["id"]),
            "terms": terms_by_category.get(str(category["id"]), []),
        }
        for category in categories
    ]
    return {
        **version,
        "id": str(version["id"]),
        "category_count": len(category_rows),
        "categories": category_rows,
    }


def create_vocabulary_draft(change_note: str, principal: StaffPrincipal) -> dict:
    response = supabase.rpc(
        "clone_published_tag_vocabulary",
        {"p_change_note": change_note, "p_actor": principal.user_id},
    ).execute()
    result = _mutation_result(response.data, "draft")
    write_audit_log(
        principal,
        domain="editorial",
        action="vocabulary.draft.create",
        resource_type="tag_vocabulary",
        resource_id=f"v{result['version_no']}",
        summary="基于当前词表创建草稿",
        after_data={"version": result["version_no"]},
    )
    return {"message": "标签词表草稿已创建。", **result}


def update_vocabulary_term(
    version_id: str,
    term_id: str,
    request: VocabularyTermUpdateRequest,
    principal: StaffPrincipal,
) -> dict:
    version = _single_row("tag_vocabulary_versions", version_id, "id,version_no,status")
    if version.get("status") != "draft":
        raise EditorialConfigConflictError("只有草稿词表可以修改")
    categories = (
        supabase.table("tag_categories")
        .select("id")
        .eq("vocabulary_version_id", version_id)
        .execute()
        .data
        or []
    )
    category_ids = [row["id"] for row in categories]
    if not category_ids:
        raise EditorialConfigNotFoundError("词表草稿没有可编辑分类")
    response = (
        supabase.table("tag_terms")
        .update(request.model_dump())
        .eq("id", term_id)
        .in_("category_id", category_ids)
        .execute()
    )
    if not response.data:
        raise EditorialConfigNotFoundError("找不到指定词条")
    term = response.data[0]
    write_audit_log(
        principal,
        domain="editorial",
        action="vocabulary.term.update",
        resource_type="tag_term",
        resource_id=term_id,
        summary=f"修改词表 v{version['version_no']} 的受控词条",
        after_data={
            "version": version["version_no"],
            "term_key": term.get("term_key"),
            "status": term.get("status"),
        },
    )
    return term


def create_vocabulary_term(
    version_id: str,
    category_id: str,
    request: VocabularyTermCreateRequest,
    principal: StaffPrincipal,
) -> dict:
    version = _single_row("tag_vocabulary_versions", version_id, "id,version_no,status")
    if version.get("status") != "draft":
        raise EditorialConfigConflictError("只有草稿词表可以新增词条")
    categories = (
        supabase.table("tag_categories")
        .select("id,category_key")
        .eq("id", category_id)
        .eq("vocabulary_version_id", version_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not categories:
        raise EditorialConfigNotFoundError("找不到指定词表分类")
    existing = (
        supabase.table("tag_terms")
        .select("id")
        .eq("category_id", category_id)
        .eq("name", request.name)
        .limit(1)
        .execute()
        .data
        or []
    )
    if existing:
        raise EditorialConfigConflictError("该分类中已经存在同名词条")
    max_rows = (
        supabase.table("tag_terms")
        .select("sort_order")
        .eq("category_id", category_id)
        .order("sort_order", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    sort_order = int(max_rows[0]["sort_order"] if max_rows else 0) + 10
    payload = {
        "category_id": category_id,
        "term_key": f"manual_{uuid.uuid4().hex}",
        "name": request.name,
        "description": request.description,
        "synonyms": request.synonyms,
        "sort_order": sort_order,
        "status": "active",
    }
    response = supabase.table("tag_terms").insert(payload).execute()
    if not response.data:
        raise RuntimeError("数据库没有返回新增词条")
    term = response.data[0]
    write_audit_log(
        principal,
        domain="editorial",
        action="vocabulary.term.create",
        resource_type="tag_term",
        resource_id=term.get("id"),
        summary=f"在词表 v{version['version_no']} 新增受控词条",
        after_data={
            "version": version["version_no"],
            "category_key": categories[0]["category_key"],
            "term_key": term.get("term_key"),
        },
    )
    return term


def publish_vocabulary_version(
    version_id: str, version_no: int, principal: StaffPrincipal
) -> dict:
    version = _single_row("tag_vocabulary_versions", version_id, "id,version_no,status")
    if int(version["version_no"]) != version_no:
        raise EditorialConfigConflictError("词表版本已变化，请刷新后重试")
    response = supabase.rpc(
        "publish_tag_vocabulary_version",
        {"p_version_id": version_id, "p_actor": principal.user_id},
    ).execute()
    result = _mutation_result(response.data, "published")
    write_audit_log(
        principal,
        domain="editorial",
        action="vocabulary.publish",
        resource_type="tag_vocabulary",
        resource_id=f"v{result['version_no']}",
        summary="发布标签词表版本",
        after_data={"version": result["version_no"]},
    )
    return {"message": "标签词表版本已发布。", **result}


def rollback_vocabulary_version(
    target_version_no: int,
    change_note: str,
    principal: StaffPrincipal,
) -> dict:
    response = supabase.rpc(
        "rollback_tag_vocabulary_version",
        {
            "p_target_version_no": target_version_no,
            "p_change_note": change_note,
            "p_actor": principal.user_id,
        },
    ).execute()
    result = _mutation_result(response.data, "published")
    write_audit_log(
        principal,
        domain="editorial",
        action="vocabulary.rollback",
        resource_type="tag_vocabulary",
        resource_id=f"v{result['version_no']}",
        summary=f"回滚词表至 v{target_version_no} 的内容",
        before_data={"target_version": target_version_no},
        after_data={"version": result["version_no"]},
    )
    return {"message": "标签词表已按历史版本内容重新发布。", **result}
