from __future__ import annotations

from app.database import supabase


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
