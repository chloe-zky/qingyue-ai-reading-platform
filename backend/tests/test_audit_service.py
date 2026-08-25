import copy
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from app.services.audit_service import list_audit_logs


class FakeAuditQuery:
    def __init__(self, rows):
        self.rows = rows
        self.filters = []
        self.max_rows = None

    def select(self, _columns="*"):
        return self

    def in_(self, key, values):
        self.filters.append(("in", key, values))
        return self

    def eq(self, key, value):
        self.filters.append(("eq", key, value))
        return self

    def gte(self, key, value):
        self.filters.append(("gte", key, value))
        return self

    def order(self, _key, desc=False):
        if desc:
            self.rows = sorted(
                self.rows, key=lambda row: row.get("created_at", ""), reverse=True
            )
        return self

    def limit(self, value):
        self.max_rows = value
        return self

    def execute(self):
        rows = self.rows
        for operation, key, value in self.filters:
            if operation == "in":
                rows = [row for row in rows if row.get(key) in value]
            elif operation == "eq":
                rows = [row for row in rows if row.get(key) == value]
            elif operation == "gte":
                rows = [row for row in rows if row.get(key, "") >= value]
        if self.max_rows is not None:
            rows = rows[: self.max_rows]
        return SimpleNamespace(data=copy.deepcopy(rows))


class FakeAuditSupabase:
    def __init__(self, tables):
        self.tables = copy.deepcopy(tables)

    def table(self, name):
        return FakeAuditQuery(self.tables[name])


def audit_row(log_id, *, actor="user-1", action="staff.update", summary="更新账号"):
    return {
        "id": log_id,
        "actor_user_id": actor,
        "actor_role": "platform_admin",
        "domain": "auth",
        "action": action,
        "resource_type": "staff_profile",
        "resource_id": f"resource-{log_id}",
        "summary": summary,
        "before_data": None,
        "after_data": None,
        "result": "success",
        "created_at": "2026-08-25T10:00:00+00:00",
    }


class AuditServiceTests(unittest.TestCase):
    def test_enriches_actor_name_and_searches_it(self):
        fake = FakeAuditSupabase(
            {
                "audit_logs": [audit_row(1), audit_row(2, actor="user-2")],
                "staff_profiles": [
                    {"user_id": "user-1", "display_name": "Chloe"},
                    {"user_id": "user-2", "display_name": "另一位编辑"},
                ],
            }
        )
        with patch("app.services.audit_service.supabase", fake):
            result = list_audit_logs(domains=["auth"], search="chloe")

        self.assertEqual([item["id"] for item in result], [1])
        self.assertEqual(result[0]["actor_display_name"], "Chloe")

    def test_applies_result_time_and_action_filters(self):
        matching = audit_row(
            3, action="prompt.publish", summary="发布 Prompt v3"
        )
        matching["domain"] = "editorial"
        fake = FakeAuditSupabase(
            {
                "audit_logs": [
                    matching,
                    {
                        **audit_row(4, action="prompt.rollback"),
                        "domain": "editorial",
                        "result": "failure",
                    },
                    {**audit_row(5, action="strategy.publish"), "domain": "editorial"},
                ],
                "staff_profiles": [
                    {"user_id": "user-1", "display_name": "负责人"}
                ],
            }
        )
        with patch("app.services.audit_service.supabase", fake):
            result = list_audit_logs(
                domains=["editorial"],
                result="success",
                action_prefix="prompt",
                action_contains="publish",
                created_after=datetime(2026, 8, 25, tzinfo=timezone.utc),
            )

        self.assertEqual([item["id"] for item in result], [3])

    def test_limit_is_applied_after_text_filtering(self):
        fake = FakeAuditSupabase(
            {
                "audit_logs": [
                    audit_row(1, summary="不匹配"),
                    audit_row(2, summary="目标一"),
                    audit_row(3, summary="目标二"),
                ],
                "staff_profiles": [
                    {"user_id": "user-1", "display_name": "负责人"}
                ],
            }
        )
        with patch("app.services.audit_service.supabase", fake):
            result = list_audit_logs(domains=["auth"], search="目标", limit=1)

        self.assertEqual(len(result), 1)
        self.assertIn("目标", result[0]["summary"])


if __name__ == "__main__":
    unittest.main()
