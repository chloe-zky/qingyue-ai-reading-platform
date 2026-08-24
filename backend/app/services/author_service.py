from io import BytesIO
from pathlib import Path
from typing import Union
from zipfile import BadZipFile, ZipFile
import xml.etree.ElementTree as ET

from app.database import supabase
from app.schemas.author import AuthorArticleCreate
from app.services.gemini_service import extract_tags_for_book


MAX_MANUSCRIPT_BYTES = 20 * 1024 * 1024
MAX_EXTRACTED_XML_BYTES = 8 * 1024 * 1024
DOCX_WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _clean_required(value: str, label: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        raise ValueError(f"{label}不能为空。")
    return cleaned


def _reference_code(book_id: int) -> str:
    return f"BR-{book_id}"


def _parse_reference(reference: Union[str, int]) -> int:
    raw = str(reference).strip().upper()
    if raw.startswith("BR-"):
        raw = raw[3:]
    if not raw.isdigit():
        raise ValueError("稿件编号格式不正确，请输入回执中的 BR-数字 编号。")
    return int(raw)


def _normalise_status(status: str) -> str:
    if status == "active":
        return "active"
    if status == "rejected":
        return "rejected"
    if status == "revision_requested":
        return "revision_requested"
    return "pending"


def _article_summary(book: dict) -> dict:
    book_id = int(book["id"])
    status = book.get("status", "pending_review")
    return {
        "book_id": book_id,
        "reference_code": _reference_code(book_id),
        "title": book.get("title", ""),
        "author": book.get("author", ""),
        "article_status": status,
        "display_status": _normalise_status(status),
        "submitted_at": book.get("created_at"),
        "editor_feedback": book.get("editor_feedback") or "",
        "reviewed_at": book.get("reviewed_at"),
    }


def submit_article_for_author(article: AuthorArticleCreate) -> dict:
    """
    作者投稿入口。
    重要：作者不再决定配图——cover_image_url / cover_photographer / cover_caption
    全部强制写空，留待编辑部在审稿时统一补齐。
    """
    data = {
        "title": _clean_required(article.title, "文章标题"),
        "author": _clean_required(article.author, "作者 / 笔名"),
        "intro": _clean_required(article.intro, "扉页语"),
        "sample": _clean_required(article.sample, "内容简介"),
        "full_content": (article.full_content or "").strip(),
        "status": "pending_review",
    }

    # 编辑配图三件套——作者侧一律写空，即便前端传了 cover_image_url 也忽略。
    cover_fields = {
        "cover_image_url":    "",
        "cover_photographer": "",
        "cover_caption":      "",
    }

    # 兼容尚未做 ALTER TABLE 的旧库：第一次带配图三字段尝试插入，
    # 若数据库报"列不存在"则回退到不带这些字段的基础 payload。
    try:
        res = supabase.table("books").insert({**data, **cover_fields}).execute()
    except Exception as e:
        msg = str(e).lower()
        if any(k in msg for k in ("cover_image_url", "cover_photographer", "cover_caption")) \
           and ("column" in msg or "schema" in msg or "not find" in msg or "does not exist" in msg):
            res = supabase.table("books").insert(data).execute()
        else:
            raise

    if not res.data:
        raise ValueError("文章保存失败，请稍后重试。")
    book_id = res.data[0]["id"]

    tag_status = "draft"
    warning = ""
    try:
        # 不自动 confirmed，以 draft 状态等待编辑部审核。
        extract_tags_for_book(book_id, auto_confirm=False)
    except Exception:
        # 稿件已经真实入库，AI 打标失败不能让前端误判为“投稿失败”。
        # 编辑端可继续人工补齐标签并审核。
        tag_status = "unavailable"
        warning = "稿件已入库；AI 标签暂未生成，编辑仍可正常审阅。"

    return {
        "message": "作品已提交，正在等待编辑审核。",
        "book_id": book_id,
        "reference_code": _reference_code(book_id),
        "title": data["title"],
        "article_status": "pending_review",
        "display_status": "pending",
        "tag_status": tag_status,
        "warning": warning,
    }


def list_author_articles(author: str, limit: int = 20) -> list:
    author_name = _clean_required(author, "作者 / 笔名")
    safe_limit = max(1, min(limit, 50))
    res = (
        supabase.table("books")
        .select("*")
        .eq("author", author_name)
        .order("id", desc=True)
        .limit(safe_limit)
        .execute()
    )
    return [_article_summary(book) for book in (res.data or [])]


def get_article_status(reference: Union[str, int]) -> dict:
    book_id = _parse_reference(reference)
    res = supabase.table("books").select("*").eq("id", book_id).execute()
    if not res.data:
        raise ValueError(f"找不到编号为 {_reference_code(book_id)} 的稿件")

    book = res.data[0]
    status = book.get("status", "pending_review")
    title = book.get("title", "")

    if status == "active":
        display_message = f"您的稿件《{title}》已通过审核。"
    elif status == "rejected":
        display_message = f"您的稿件《{title}》暂未通过审核。"
    elif status == "revision_requested":
        display_message = f"您的稿件《{title}》需要修改后再次递交。"
    else:
        display_message = f"您的稿件《{title}》正在等待审核。"

    return {
        **_article_summary(book),
        "display_message": display_message,
    }


def extract_docx_text(filename: str, file_bytes: bytes) -> dict:
    """从 DOCX 中提取可审阅正文；文件不落盘、不写 Storage。"""
    if Path(filename or "").suffix.lower() != ".docx":
        raise ValueError("目前仅支持 .docx 文件；旧版 .doc 请先另存为 .docx。")
    if not file_bytes:
        raise ValueError("上传的 Word 文档为空。")
    if len(file_bytes) > MAX_MANUSCRIPT_BYTES:
        raise ValueError("Word 文档超过 20MB，请压缩后重试。")

    try:
        with ZipFile(BytesIO(file_bytes)) as archive:
            info = archive.getinfo("word/document.xml")
            if info.file_size > MAX_EXTRACTED_XML_BYTES:
                raise ValueError("文档正文结构过大，请拆分或精简后重试。")
            xml_bytes = archive.read(info)
    except (BadZipFile, KeyError):
        raise ValueError("无法读取该 DOCX，请确认文件未损坏且不是改后缀的旧版 DOC。")

    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        raise ValueError("Word 文档正文结构损坏，无法提取文字。")

    paragraphs = []
    paragraph_tag = f"{{{DOCX_WORD_NS}}}p"
    text_tag = f"{{{DOCX_WORD_NS}}}t"
    tab_tag = f"{{{DOCX_WORD_NS}}}tab"
    break_tag = f"{{{DOCX_WORD_NS}}}br"

    for paragraph in root.iter(paragraph_tag):
        parts = []
        for node in paragraph.iter():
            if node.tag == text_tag and node.text:
                parts.append(node.text)
            elif node.tag == tab_tag:
                parts.append("\t")
            elif node.tag == break_tag:
                parts.append("\n")
        text = "".join(parts).strip()
        if text:
            paragraphs.append(text)

    full_content = "\n\n".join(paragraphs).strip()
    if not full_content:
        raise ValueError("没有从 DOCX 中读到正文文字。")
    if len(full_content) > 500_000:
        raise ValueError("提取后的正文超过 50 万字，请拆分后投稿。")

    return {
        "filename": filename,
        "full_content": full_content,
        "character_count": len("".join(full_content.split())),
        "message": "Word 文档已读取为可审阅正文；原文件未保存。",
    }
