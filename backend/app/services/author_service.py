from __future__ import annotations

from io import BytesIO
import hashlib
from pathlib import Path
import secrets
from typing import Union
from zipfile import BadZipFile, ZipFile
import xml.etree.ElementTree as ET

from app.database import supabase
from app.schemas.author import AuthorArticleCreate
from app.services.gemini_service import extract_tags_for_book


MAX_MANUSCRIPT_BYTES = 20 * 1024 * 1024
MAX_EXTRACTED_XML_BYTES = 8 * 1024 * 1024
MAX_DOCX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
MAX_DOCX_COMPRESSION_RATIO = 100
MAX_DOCX_ENTRIES = 2048
UPLOAD_READ_CHUNK_BYTES = 64 * 1024
DOCX_WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


class AuthorReceiptError(ValueError):
    pass


class AuthorSubmissionStateConflictError(ValueError):
    pass


async def read_manuscript_upload(file) -> bytes:
    """Read at most the accepted DOCX size instead of buffering an unbounded body."""
    chunks = []
    size = 0
    while True:
        chunk = await file.read(UPLOAD_READ_CHUNK_BYTES)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_MANUSCRIPT_BYTES:
            raise ValueError("Word 文档超过 20MB，请压缩后重试。")
        chunks.append(chunk)
    return b"".join(chunks)


def _clean_required(value: str, label: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        raise ValueError(f"{label}不能为空。")
    return cleaned


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _reference_code(book_id: int, token: str) -> str:
    return f"BR-{book_id}-{token}"


def _parse_reference(reference: Union[str, int]) -> tuple[int, str]:
    raw = str(reference).strip()
    parts = raw.split("-", 2)
    if len(parts) != 3 or parts[0].upper() != "BR" or not parts[1].isdigit():
        raise AuthorReceiptError("稿件编号格式不正确，请粘贴回执上的完整安全编号。")
    token = parts[2].strip()
    if len(token) < 20:
        raise AuthorReceiptError("稿件编号格式不正确，请粘贴回执上的完整安全编号。")
    return int(parts[1]), token


def _normalise_status(status: str) -> str:
    if status == "active":
        return "active"
    if status == "rejected":
        return "rejected"
    if status == "revision_requested":
        return "revision_requested"
    return "pending"


def _article_summary(book: dict, reference_code: str | None = None, *, include_content: bool = False) -> dict:
    book_id = int(book["id"])
    status = book.get("status", "pending_review")
    result = {
        "book_id": book_id,
        "reference_code": reference_code or f"BR-{book_id}-••••••••",
        "title": book.get("title", ""),
        "author": book.get("author", ""),
        "article_status": status,
        "display_status": _normalise_status(status),
        "submitted_at": book.get("created_at"),
        "editor_feedback": book.get("editor_feedback") or "",
        "reviewed_at": book.get("reviewed_at"),
        "revision_no": book.get("current_revision_no", 1),
    }
    if include_content:
        result.update({
            "intro": book.get("intro", ""),
            "sample": book.get("sample", ""),
            "full_content": book.get("full_content", ""),
        })
    return result


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

    if article.revision_reference:
        book_id, token = _parse_reference(article.revision_reference)
        try:
            rpc = supabase.rpc("resubmit_author_article_secure", {
                "p_book_id": book_id,
                "p_token_hash": _token_hash(token),
                "p_title": data["title"],
                "p_author": data["author"],
                "p_intro": data["intro"],
                "p_sample": data["sample"],
                "p_full_content": data["full_content"],
            }).execute()
        except Exception as error:
            message = str(error).lower()
            if "invalid author receipt" in message:
                raise AuthorReceiptError("安全编号无效，请使用原投稿回执中的完整编号。") from error
            if "not open for resubmission" in message:
                raise AuthorSubmissionStateConflictError(
                    "该稿件当前不能再次递交，请先等待编辑给出退修或退稿决定。"
                ) from error
            raise
        reference_code = article.revision_reference
        message = "修订稿已递交，正在等待编辑复审。"
    else:
        token = secrets.token_urlsafe(24)
        rpc = supabase.rpc("submit_author_article_secure", {
            "p_title": data["title"],
            "p_author": data["author"],
            "p_intro": data["intro"],
            "p_sample": data["sample"],
            "p_full_content": data["full_content"],
            "p_token_hash": _token_hash(token),
        }).execute()
        payload = rpc.data or {}
        if isinstance(payload, list):
            payload = payload[0] if payload else {}
        book_id = int(payload.get("book_id") or 0)
        if not book_id:
            raise ValueError("文章保存失败，请稍后重试。")
        reference_code = _reference_code(book_id, token)
        message = "作品已提交，正在等待编辑审核。"

    payload = rpc.data or {}
    if isinstance(payload, list):
        payload = payload[0] if payload else {}

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
        "message": message,
        "book_id": book_id,
        "reference_code": reference_code,
        "title": data["title"],
        "article_status": "pending_review",
        "display_status": "pending",
        "tag_status": tag_status,
        "revision_no": int(payload.get("revision_no") or 1),
        "submitted_at": payload.get("submitted_at"),
        "warning": warning,
    }


def list_author_articles(references: list[str]) -> list:
    articles = []
    for reference in references[:50]:
        try:
            articles.append(get_article_status(reference))
        except ValueError:
            continue
    return sorted(articles, key=lambda item: item["book_id"], reverse=True)


def get_article_status(reference: Union[str, int]) -> dict:
    book_id, token = _parse_reference(reference)
    reference_code = _reference_code(book_id, token)
    res = (
        supabase.table("books")
        .select("*")
        .eq("id", book_id)
        .eq("author_access_token_hash", _token_hash(token))
        .limit(1)
        .execute()
    )
    if not res.data:
        raise AuthorReceiptError("找不到该稿件，请检查是否粘贴了完整安全编号。")

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
        **_article_summary(book, reference_code, include_content=True),
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
            entries = archive.infolist()
            if len(entries) > MAX_DOCX_ENTRIES:
                raise ValueError("DOCX 内部文件数量异常，请重新导出后上传。")
            if sum(item.file_size for item in entries) > MAX_DOCX_UNCOMPRESSED_BYTES:
                raise ValueError("DOCX 解压后体积过大，请精简文档后重试。")
            info = archive.getinfo("word/document.xml")
            if info.file_size > MAX_EXTRACTED_XML_BYTES:
                raise ValueError("文档正文结构过大，请拆分或精简后重试。")
            if info.flag_bits & 0x1:
                raise ValueError("不支持加密 DOCX，请解除密码后重试。")
            if info.file_size and (
                info.compress_size <= 0
                or info.file_size / info.compress_size > MAX_DOCX_COMPRESSION_RATIO
            ):
                raise ValueError("DOCX 压缩比异常，请重新导出后上传。")
            xml_bytes = archive.read(info)
    except (BadZipFile, KeyError):
        raise ValueError("无法读取该 DOCX，请确认文件未损坏且不是改后缀的旧版 DOC。")

    upper_xml = xml_bytes.upper()
    if b"<!DOCTYPE" in upper_xml or b"<!ENTITY" in upper_xml:
        raise ValueError("DOCX 包含不安全的 XML 声明，请重新导出后上传。")

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
