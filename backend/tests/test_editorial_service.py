import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.schemas.editorial import (
    PromptDraftRequest,
    PromptTestRequest,
    StrategySimulationRequest,
)
from app.services.editorial_service import (
    EditorialConfigConflictError,
    _validate_prompt_template,
    simulate_strategy,
    test_prompt_draft,
)
from app.services.gemini_service import _render_prompt_template
from app.services.tag_service import filter_tags


class EditorialPromptSafetyTests(unittest.TestCase):
    def test_template_variables_must_match_declared_variables(self):
        request = PromptDraftRequest(
            name="元数据打标",
            system_prompt="只根据随后提供的信息判断。",
            user_prompt_template="标题：{{title}}\n简介：{{sample}}",
            variables=["title"],
        )
        with self.assertRaisesRegex(
            EditorialConfigConflictError, "必须与模板中实际使用"
        ):
            _validate_prompt_template(request)

    def test_renderer_substitutes_only_metadata_fields(self):
        rendered = _render_prompt_template(
            "{{title}}｜{{intro}}｜{{sample}}",
            {"title": "春日", "intro": "一句话", "sample": "简介"},
        )
        self.assertEqual(rendered, "春日｜一句话｜简介")


class ControlledVocabularyTests(unittest.TestCase):
    def test_filters_unpublished_aesthetic_and_risk_terms(self):
        vocab = {
            "setting_tags": ["现代"],
            "story_tone_tags": ["温暖治愈"],
            "relationship_core_tags": ["相伴成长"],
            "aesthetic_tags": ["克制"],
            "risk_tags": ["校园霸凌"],
        }
        result = filter_tags(
            {
                "setting_tags": ["现代"],
                "story_tone_tags": ["温暖治愈"],
                "relationship_core_tags": ["相伴成长"],
                "aesthetic_tags": ["克制", "未受控风格"],
                "risk_tags": ["校园霸凌", "任意风险"],
                "recommend_reason": "温柔而克制的成长故事",
            },
            vocab,
        )
        self.assertEqual(result["aesthetic_tags"], ["克制"])
        self.assertEqual(result["risk_tags"], ["校园霸凌"])


class FakeReadQuery:
    def __init__(self, rows):
        self.rows = rows
        self.filters = []

    def select(self, _columns="*"):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def execute(self):
        rows = [
            row
            for row in self.rows
            if all(row.get(key) == value for key, value in self.filters)
        ]
        return SimpleNamespace(data=rows)


class FakeReadSupabase:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return FakeReadQuery(self.tables[name])


class EditorialToolExecutionTests(unittest.TestCase):
    def test_prompt_test_sends_only_rendered_metadata(self):
        request = PromptTestRequest(
            system_prompt="只分析元数据",
            user_prompt_template="标题：{{title}}\n扉页：{{intro}}\n简介：{{sample}}",
            variables=["title", "intro", "sample"],
            title="春日",
            intro="相逢",
            sample="两位故友在车站重逢。",
        )
        config = {
            "api_type": "openai_compatible",
            "api_base": "https://example.com/v1",
            "api_key": "secret",
            "model_name": "test-model",
            "timeout_seconds": 10,
            "max_retries": 0,
        }
        vocab = {
            "setting_tags": ["现代"],
            "story_tone_tags": ["温暖治愈"],
            "relationship_core_tags": ["久别重逢"],
            "aesthetic_tags": ["克制"],
            "risk_tags": [],
        }
        raw = '{"setting_tags":["现代"],"story_tone_tags":["温暖治愈"],"relationship_core_tags":["久别重逢"],"aesthetic_tags":["克制"],"risk_tags":[],"recommend_reason":"适合轻阅读"}'
        with patch(
            "app.services.editorial_service.get_editorial_prompt",
            return_value={"name": "元数据打标", "description": "", "prompt_key": "tagging"},
        ), patch(
            "app.services.editorial_service.get_active_llm_config",
            return_value=config,
        ), patch(
            "app.services.editorial_service.call_openai_compatible_llm",
            return_value=raw,
        ) as call, patch(
            "app.services.editorial_service.get_valid_vocabularies",
            return_value=vocab,
        ), patch("app.services.editorial_service.write_audit_log"):
            principal = SimpleNamespace(user_id="lead", role=SimpleNamespace(value="editorial_lead"))
            result = test_prompt_draft("prompt-1", request, principal)

        sent_prompt = call.call_args.args[3]
        self.assertIn("春日", sent_prompt)
        self.assertIn("两位故友在车站重逢。", sent_prompt)
        self.assertNotIn("{{title}}", sent_prompt)
        self.assertEqual(result["model_name"], "test-model")
        self.assertEqual(result["output"]["relationship_core_tags"], ["久别重逢"])

    def test_strategy_simulation_scores_without_writing_recommendation_log(self):
        fake = FakeReadSupabase(
            {
                "books": [
                    {"id": 1, "title": "完全匹配", "author": "甲", "status": "active"},
                    {"id": 2, "title": "部分匹配", "author": "乙", "status": "active"},
                ],
                "book_ai_tags": [
                    {"book_id": 1, "setting_tags": ["现代"], "story_tone_tags": ["温暖治愈"], "relationship_core_tags": ["相伴成长"], "tag_status": "confirmed"},
                    {"book_id": 2, "setting_tags": ["现代"], "story_tone_tags": ["遗憾青春"], "relationship_core_tags": [], "tag_status": "confirmed"},
                ],
            }
        )
        request = StrategySimulationRequest(
            setting_weight=15,
            story_tone_weight=40,
            relationship_core_weight=45,
            max_score=96,
            result_limit=6,
            setting_tags=["现代"],
            story_tone_tags=["温暖治愈"],
            relationship_core_tags=["相伴成长"],
        )
        principal = SimpleNamespace(user_id="lead", role=SimpleNamespace(value="editorial_lead"))
        with patch("app.services.editorial_service.supabase", fake), patch(
            "app.services.editorial_service.get_editorial_strategy",
            return_value={"strategy_key": "emotional_tag_match"},
        ), patch("app.services.editorial_service.write_audit_log"):
            result = simulate_strategy("strategy-1", request, principal)

        self.assertEqual(result["candidate_count"], 2)
        self.assertEqual(result["results"][0]["score"], 96)
        self.assertEqual(result["results"][0]["title"], "完全匹配")


if __name__ == "__main__":
    unittest.main()
