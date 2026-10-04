import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.schemas.book import BookCreate
from app.services.book_service import (
    create_book,
    get_all_books,
    get_public_book_detail,
    normalize_search_query,
    search_public_books,
)
from test_reader_service import FakeSupabase


class BookCreationTests(unittest.TestCase):
    def test_internal_book_creation_supplies_required_receipt_hash(self):
        fake = MagicMock()
        fake.rpc.return_value.execute.return_value = SimpleNamespace(data=42)

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
            result = create_book(book, "11111111-1111-1111-1111-111111111111")

        name, payload = fake.rpc.call_args.args
        self.assertEqual(name, "create_internal_review_book")
        self.assertEqual(payload["p_author_access_token_hash"], "a" * 64)
        self.assertEqual(payload["p_actor"], "11111111-1111-1111-1111-111111111111")
        self.assertEqual(result, 42)

    def test_internal_book_creation_is_not_published_until_reviewed(self):
        """新增作品必须显式进入 pending_review，且标签初始化为 draft。

        不能依赖数据库列默认值：库默认是 active，一旦依赖它，新增作品会立刻
        变成「已公开但标签未确认」，正是线上出现 active+draft 脏数据的成因。
        """
        fake = MagicMock()
        fake.rpc.return_value.execute.return_value = SimpleNamespace(data=7)

        book = BookCreate(
            title="冬天",
            author="林夏",
            intro="简介",
            sample="样章",
            full_content="正文",
        )
        with patch("app.services.book_service.supabase", fake):
            result = create_book(book, "11111111-1111-1111-1111-111111111111")

        name, payload = fake.rpc.call_args.args
        self.assertEqual(name, "create_internal_review_book")
        self.assertEqual(payload["p_title"], "冬天")
        self.assertEqual(result, 7)


class PublicBookDetailTests(unittest.TestCase):
    def test_detail_only_reads_active_book(self):
        query = MagicMock()
        query.select.return_value = query
        query.eq.return_value = query
        query.limit.return_value = query
        query.execute.return_value = SimpleNamespace(data=[{
            "id": 7,
            "title": "春日",
            "full_content": "正文",
        }])
        fake = MagicMock()
        fake.table.return_value = query

        with patch("app.services.book_service.supabase", fake):
            result = get_public_book_detail(7)

        self.assertEqual(result["full_content"], "正文")
        self.assertEqual(query.eq.call_args_list[0].args, ("id", 7))
        self.assertEqual(query.eq.call_args_list[1].args, ("status", "active"))

    def test_detail_returns_none_when_book_is_not_public(self):
        query = MagicMock()
        query.select.return_value = query
        query.eq.return_value = query
        query.limit.return_value = query
        query.execute.return_value = SimpleNamespace(data=[])
        fake = MagicMock()
        fake.table.return_value = query

        with patch("app.services.book_service.supabase", fake):
            self.assertIsNone(get_public_book_detail(404))


def search_tables():
    return {
        "books": [
            {"id": 1, "title": "倾城", "author": "吕亦涵", "intro": "百年",
             "status": "active", "created_at": "2026-09-01T00:00:00+00:00",
             "cover_image_url": "https://cdn/1.jpg", "cover_photographer": "",
             "cover_caption": "", "full_content": "正文一"},
            {"id": 2, "title": "西窗烛", "author": "沈鱼藻", "intro": "江南",
             "status": "active", "created_at": "2026-09-02T00:00:00+00:00",
             "cover_image_url": "", "cover_photographer": "", "cover_caption": "",
             "full_content": "正文二"},
            {"id": 3, "title": "倾城之恋", "author": "张爱玲", "intro": "香港",
             "status": "pending_review", "created_at": "2026-09-03T00:00:00+00:00",
             "cover_image_url": "", "cover_photographer": "", "cover_caption": "",
             "full_content": "未发布"},
            {"id": 27, "title": "去似朝云无觅处", "author": "绿亦歌", "intro": "彩蛋",
             "status": "active", "created_at": "2026-09-04T00:00:00+00:00",
             "cover_image_url": "", "cover_photographer": "Photukay",
             "cover_caption": "模特：莫非万里、波子橙", "full_content": "彩蛋正文"},
        ],
    }


class BookSearchTests(unittest.TestCase):
    def search(self, keyword, data=None, limit=20):
        fake = FakeSupabase(data or search_tables())
        with patch("app.services.book_service.supabase", fake):
            return search_public_books(keyword, limit)

    def test_title_fragment_finds_the_article(self):
        results = self.search("倾城")
        self.assertEqual([row["book_id"] for row in results], [1])
        self.assertEqual(results[0]["title"], "倾城")

    def test_author_fragment_finds_the_article(self):
        results = self.search("沈鱼")
        self.assertEqual([row["book_id"] for row in results], [2])

    def test_unpublished_articles_never_surface(self):
        # 《倾城之恋》标题里含「倾城」，但仍是 pending_review。
        results = self.search("倾城")
        self.assertNotIn(3, [row["book_id"] for row in results])

    def test_easter_egg_article_is_hidden_from_search_and_catalog(self):
        fake = FakeSupabase(search_tables())
        with patch("app.services.book_service.supabase", fake):
            self.assertEqual(search_public_books("去似朝云"), [])
            self.assertNotIn(27, [row["id"] for row in get_all_books()])

    def test_full_text_is_not_searched_and_not_returned(self):
        self.assertEqual(self.search("正文一"), [])
        for row in self.search("倾城"):
            self.assertNotIn("full_content", row)
            self.assertNotIn("status", row)

    def test_matching_is_case_insensitive_and_trims_whitespace(self):
        data = search_tables()
        data["books"].append({
            "id": 4, "title": "Moonlight", "author": "Luna", "intro": "",
            "status": "active", "created_at": "2026-09-04T00:00:00+00:00",
            "cover_image_url": "", "cover_photographer": "", "cover_caption": "",
        })
        self.assertEqual([r["book_id"] for r in self.search("  moon ", data)], [4])

    def test_blank_and_wildcard_only_queries_return_nothing(self):
        # 去掉通配符后为空 → 不应退化成「匹配全部」。
        for keyword in ("", "   ", "%", "%%", "*", "_"):
            self.assertEqual(self.search(keyword), [], keyword)

    def test_wildcards_inside_a_query_are_stripped_not_honoured(self):
        # 「倾%城」不该被当成 ilike 通配符去匹配「倾城之恋」之外的东西，
        # 而是清成字面量「倾城」。
        self.assertEqual([r["book_id"] for r in self.search("倾%城")], [1])

    def test_limit_is_clamped_and_applied(self):
        data = search_tables()
        data["books"].extend([
            {"id": 10 + i, "title": f"倾城{i}", "author": "某人", "intro": "",
             "status": "active", "created_at": "2026-09-05T00:00:00+00:00",
             "cover_image_url": "", "cover_photographer": "", "cover_caption": ""}
            for i in range(5)
        ])
        self.assertEqual(len(self.search("倾城", data, limit=2)), 2)
        self.assertEqual(len(self.search("倾城", data, limit=999)), 6)

    def test_title_hits_rank_above_author_hits(self):
        data = search_tables()
        data["books"].append({
            "id": 5, "title": "另一篇", "author": "倾城工作室", "intro": "",
            "status": "active", "created_at": "2026-09-06T00:00:00+00:00",
            "cover_image_url": "", "cover_photographer": "", "cover_caption": "",
        })
        self.assertEqual([r["book_id"] for r in self.search("倾城", data)], [1, 5])

    def test_query_length_is_capped(self):
        self.assertEqual(len(normalize_search_query("字" * 500)), 40)


if __name__ == "__main__":
    unittest.main()
