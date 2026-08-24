import json

def clean_and_parse_json(raw_text: str) -> dict:
    try:
        clean_text = raw_text.strip().strip('`').removeprefix('json\n').removeprefix('json')
        return json.loads(clean_text)
    except json.JSONDecodeError as e:
        raise ValueError(f"AI 返回的 JSON 格式错误: {e}. 原始内容: {raw_text}")