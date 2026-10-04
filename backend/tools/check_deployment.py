"""Read-only production preflight for Supabase schema and storage."""

from __future__ import annotations

import sys

import httpx

from app.config import SUPABASE_SERVICE_KEY, SUPABASE_URL
from app.database import supabase


REQUIRED_TABLES = (
    "books",
    "book_ai_tags",
    "feedbacks",
    "recommendation_logs",
    "staff_profiles",
    "editorial_prompts",
    "editorial_prompt_versions",
    "editorial_strategies",
    "editorial_strategy_versions",
    "tag_vocabulary_versions",
    "tag_categories",
    "tag_terms",
    "reader_profiles",
    "reader_favorites",
    "reading_history",
    "reader_daily_preferences",
    "system_configs",
    "system_config_secrets",
)

REQUIRED_RPCS = (
    "_apply_book_preference_signal",
    "claim_submission_for_review",
    "clone_published_tag_vocabulary",
    "create_internal_review_book",
    "get_book_quality_scores",
    "get_recommendation_context",
    "publish_editorial_prompt_version",
    "publish_editorial_strategy_version",
    "publish_reviewed_book",
    "publish_tag_vocabulary_version",
    "record_reader_feedback_atomic",
    "record_reader_progress_atomic",
    "release_submission_review_claim",
    "resubmit_author_article_secure",
    "rollback_editorial_prompt_version",
    "rollback_editorial_strategy_version",
    "rollback_tag_vocabulary_version",
    "set_reader_favorite_atomic",
    "store_encrypted_system_secret",
    "submit_author_article_secure",
    "update_llm_config_atomic",
    "update_staff_account_atomic",
)


def main() -> int:
    failures: list[str] = []
    for table in REQUIRED_TABLES:
        try:
            supabase.table(table).select("*", count="exact").limit(0).execute()
        except Exception as exc:
            failures.append(f"table {table}: {type(exc).__name__}")

    try:
        buckets = supabase.storage.list_buckets() or []
        bucket_names = {
            str(item.get("name") if isinstance(item, dict) else getattr(item, "name", ""))
            for item in buckets
        }
        if "covers" not in bucket_names:
            failures.append("storage bucket covers: missing")
    except Exception as exc:
        failures.append(f"storage: {type(exc).__name__}")

    try:
        response = httpx.get(
            f"{SUPABASE_URL.rstrip('/')}/rest/v1/",
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Accept": "application/openapi+json",
            },
            timeout=20,
        )
        response.raise_for_status()
        paths = response.json().get("paths", {})
        for function in REQUIRED_RPCS:
            if f"/rpc/{function}" not in paths:
                failures.append(f"rpc {function}: missing")
    except Exception as exc:
        failures.append(f"OpenAPI RPC check: {type(exc).__name__}")

    if failures:
        print("Deployment preflight failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print(
        "Deployment preflight passed: "
        f"{len(REQUIRED_TABLES)} tables, {len(REQUIRED_RPCS)} RPCs and covers storage"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
