import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from test_book_service import search_tables
from test_reader_service import FakeSupabase


class BookSearchApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def setUp(self):
        patcher = patch(
            "app.services.book_service.supabase", FakeSupabase(search_tables())
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def search(self, params):
        return self.client.get("/api/books/search", params=params)

    def test_search_route_is_not_swallowed_by_the_book_id_route(self):
        # /api/books/{book_id} 会把 "search" 当成路径参数吃掉，所以搜索路由
        # 必须先注册。这条断言就是那个顺序的守卫。
        response = self.search({"q": "倾城"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["book_id"] for row in response.json()], [1])

    def test_author_fragment_hits(self):
        response = self.search({"q": "沈鱼"})
        self.assertEqual([row["book_id"] for row in response.json()], [2])

    def test_public_payload_carries_no_internal_fields(self):
        row = self.search({"q": "倾城"}).json()[0]
        self.assertEqual(
            set(row),
            {"book_id", "id", "title", "author", "intro",
             "cover_image_url", "cover_photographer", "cover_caption"},
        )

    def test_pending_review_articles_are_invisible(self):
        ids = [row["book_id"] for row in self.search({"q": "倾城"}).json()]
        self.assertNotIn(3, ids)

    def test_easter_egg_article_is_invisible(self):
        self.assertEqual(self.search({"q": "去似朝云"}).json(), [])

    def test_empty_query_returns_an_empty_list_not_everything(self):
        for params in ({}, {"q": ""}, {"q": "   "}):
            response = self.search(params)
            self.assertEqual(response.status_code, 200, params)
            self.assertEqual(response.json(), [], params)

    def test_out_of_range_limit_is_rejected(self):
        self.assertEqual(self.search({"q": "倾城", "limit": 0}).status_code, 422)
        self.assertEqual(self.search({"q": "倾城", "limit": 999}).status_code, 422)

    def test_absurdly_long_query_is_rejected_before_reaching_the_database(self):
        self.assertEqual(self.search({"q": "字" * 500}).status_code, 422)

    def test_search_requires_no_authentication(self):
        # 搜索是公开能力：不带任何令牌也应当可用。
        self.assertEqual(self.search({"q": "倾城"}).status_code, 200)


if __name__ == "__main__":
    unittest.main()
