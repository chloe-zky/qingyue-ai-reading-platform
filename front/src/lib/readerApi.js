import { apiFetch } from './apiClient';

async function readerFetch(path, { method = 'GET', body, keepalive = false } = {}) {
  return apiFetch(path, { method, body, keepalive, auth: 'reader' });
}

export const readerApi = {
  me: () => readerFetch('/api/reader/me'),
  updateMe: (changes) => readerFetch('/api/reader/me', {
    method: 'PATCH', body: changes,
  }),
  // 头像走 multipart：apiFetch 见到 FormData 会跳过 JSON 序列化，
  // 也不会自己设 Content-Type（必须让浏览器带 boundary）。
  uploadAvatar: (file) => {
    const form = new FormData();
    form.append('file', file);
    return readerFetch('/api/reader/avatar', { method: 'POST', body: form });
  },
  favorites: () => readerFetch('/api/reader/favorites'),
  favoriteState: (bookId) => readerFetch(`/api/reader/favorites/${encodeURIComponent(bookId)}`),
  addFavorite: (bookId) => readerFetch(`/api/reader/favorites/${encodeURIComponent(bookId)}`, { method: 'POST' }),
  removeFavorite: (bookId) => readerFetch(`/api/reader/favorites/${encodeURIComponent(bookId)}`, { method: 'DELETE' }),
  history: () => readerFetch('/api/reader/history'),
  // 后端按 (当前读者, book_id) 删除并且是幂等的：重复调用不会报错。
  deleteHistory: (bookId) => readerFetch(`/api/reader/history/${encodeURIComponent(bookId)}`, {
    method: 'DELETE',
  }),
  saveProgress: (bookId, progressPercent, options = {}) => readerFetch(`/api/reader/history/${encodeURIComponent(bookId)}`, {
    method: 'PUT',
    keepalive: Boolean(options.keepalive),
    body: {
      progress_percent: progressPercent,
      active_seconds_delta: options.activeSecondsDelta || 0,
      opened: Boolean(options.opened),
      request_id: options.requestId || null,
    },
  }),
};
