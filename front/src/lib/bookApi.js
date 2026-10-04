import { apiFetch } from './apiClient';

const DETAIL_TTL_MS = 5 * 60_000;
const detailCache = new Map();
const inFlight = new Map();

function articleId(article) {
  return Number(article?.book_id ?? article?.id);
}

function fresh(entry) {
  return Boolean(entry) && Date.now() - entry.at < DETAIL_TTL_MS;
}

/**
 * 按标题 / 作者搜索已发布作品。公开接口，不带凭证。
 * signal 由调用方传入，用于在关键词变化时取消上一次请求。
 */
export async function searchBooks(query, { limit = 20, signal } = {}) {
  const keyword = String(query ?? '').trim();
  if (!keyword) return [];
  const params = new URLSearchParams({ q: keyword, limit: String(limit) });
  const data = await apiFetch(`/api/books/search?${params}`, { auth: false, signal });
  return Array.isArray(data) ? data : [];
}

export async function getPublicBookDetail(bookId, {
  expectedCoverUrl = '',
  expectedCoverPhotographer,
  expectedCoverCaption,
} = {}) {
  const id = Number(bookId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('作品编号无效');

  const cached = detailCache.get(id);
  const expectedCover = String(expectedCoverUrl || '').trim();
  const cachedCover = String(cached?.value?.cover_image_url || '').trim();
  const photographerMatches = expectedCoverPhotographer === undefined
    || String(cached?.value?.cover_photographer || '').trim()
      === String(expectedCoverPhotographer || '').trim();
  const captionMatches = expectedCoverCaption === undefined
    || String(cached?.value?.cover_caption || '').trim()
      === String(expectedCoverCaption || '').trim();
  // 推荐卡片比五分钟详情缓存更新时（例如编辑刚替换封面），
  // 不能再让旧详情把新卡片的封面覆盖回去。发现不一致就重取详情。
  if (
    fresh(cached)
    && (!expectedCover || cachedCover === expectedCover)
    && photographerMatches
    && captionMatches
  ) {
    return cached.value;
  }
  if (inFlight.has(id)) return inFlight.get(id);

  const task = apiFetch(`/api/books/${id}`, { auth: false })
    .then((value) => {
      detailCache.set(id, { at: Date.now(), value });
      return value;
    })
    .finally(() => inFlight.delete(id));
  inFlight.set(id, task);
  return task;
}

export async function hydrateArticle(article) {
  const id = articleId(article);
  const detail = await getPublicBookDetail(id, {
    expectedCoverUrl: article?.cover_image_url,
    expectedCoverPhotographer: article?.cover_photographer,
    expectedCoverCaption: article?.cover_caption,
  });
  return { ...article, ...detail, book_id: id };
}

export function clearBookDetailCache(bookId) {
  if (bookId === undefined) detailCache.clear();
  else detailCache.delete(Number(bookId));
}
