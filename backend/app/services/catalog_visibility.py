"""Visibility rules for stories with intentional, non-catalog entry points."""


EASTER_EGG_BOOK_IDS = frozenset({27})
EASTER_EGG_BOOK_TITLES = frozenset({"去似朝云无觅处"})


def is_hidden_from_catalog(book: dict) -> bool:
    """Return whether a published story must stay out of ordinary reader lists."""
    try:
        book_id = int(book.get("id"))
    except (TypeError, ValueError):
        book_id = None
    title = str(book.get("title") or "").strip()
    return book_id in EASTER_EGG_BOOK_IDS or title in EASTER_EGG_BOOK_TITLES
