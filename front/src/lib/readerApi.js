import { apiFetch } from './apiClient';

async function readerFetch(path, { method = 'GET', body, keepalive = false } = {}) {
  return apiFetch(path, { method, body, keepalive, auth: 'reader' });
}

export const readerApi = {
  me: () => readerFetch('/api/reader/me'),
  updateMe: (changes) => readerFetch('/api/reader/me', {
    method: 'PATCH', body: changes,
  }),
  favorites: () => readerFetch('/api/reader/favorites'),
  favoriteState: (bookId) => readerFetch(`/api/reader/favorites/${encodeURIComponent(bookId)}`),
  addFavorite: (bookId) => readerFetch(`/api/reader/favorites/${encodeURIComponent(bookId)}`, { method: 'POST' }),
  removeFavorite: (bookId) => readerFetch(`/api/reader/favorites/${encodeURIComponent(bookId)}`, { method: 'DELETE' }),
  history: () => readerFetch('/api/reader/history'),
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
