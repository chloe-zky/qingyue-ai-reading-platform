import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.schemas.book import BookCreate
from app.services.book_service import create_book


class BookCreationTests(unittest.TestCase):
    def test_internal_book_creation_supplies_required_receipt_hash(self):
        insert_query = MagicMock()
        insert_query.execute.return_value = SimpleNamespace(data=[{"id": 42}])
        tag_query = MagicMock()
        tag_query.execute.return_value = SimpleNamespace(data=[{"book_id": 42}])
        book_table = MagicMock(insert=MagicMock(return_value=insert_query))
        tag_table = MagicMock(insert=MagicMock(return_value=tag_query))
        fake = MagicMock()
        fake.table.side_effect = [book_table, tag_table]

        book = BookCreate(
            title="冬天",
            author="林夏",
            intro="简介",
            sample="样章",
            full_content="正文",
        )
        with patch("app.services.book_service.supabase", fake), patch(
            "app.services.book_service.secrets.token_hex", return_value="a" * 64
        ):
            result = create_book(book)

        inserted_payload = book_table.insert.call_args.args[0]
        self.assertEqual(inserted_payload["author_access_token_hash"], "a" * 64)
        self.assertEqual(result, 42)


if __name__ == "__main__":
    unittest.main()
