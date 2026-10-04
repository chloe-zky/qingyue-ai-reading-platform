// searchState.js — 发现页搜索的纯逻辑：输入归一、竞态判定、状态推导。
//
// 抽出来的两条是最容易出 bug 的：
//   1. 竞态——用户连打几个字，先发的慢请求不能覆盖后发的快请求结果。
//   2. 清空——退出搜索必须回到搜索前的推荐页与页码，而不是重新触发一次推荐，
//      更不能把当天已保存的偏好状态覆盖掉。

export const MIN_QUERY_LENGTH = 1;
export const MAX_QUERY_LENGTH = 40;
export const DEBOUNCE_MS = 280;

/** 与后端 normalize_search_query 对齐：去首尾空格、压缩空白、砍掉通配符。 */
export function normalizeQuery(raw) {
  let cleaned = String(raw ?? '').trim().replace(/\s+/g, ' ');
  for (const wildcard of ['%', '_', '*']) {
    cleaned = cleaned.split(wildcard).join('');
  }
  return cleaned.slice(0, MAX_QUERY_LENGTH);
}

export function isSearchable(raw) {
  return normalizeQuery(raw).length >= MIN_QUERY_LENGTH;
}

export const idleSearch = () => ({ phase: 'idle', query: '', results: [], message: '' });

export const loadingSearch = (query) => ({
  phase: 'loading', query, results: [], message: '',
});

export function resultsSearch(query, results) {
  const list = Array.isArray(results) ? results : [];
  return {
    phase: list.length ? 'results' : 'empty',
    query,
    results: list,
    message: list.length ? '' : `没有找到与「${query}」相关的作品`,
  };
}

export const errorSearch = (query, error) => ({
  phase: 'error',
  query,
  results: [],
  message: error?.detail || error?.message || '搜索失败，请稍后重试',
});

/**
 * 一次响应是否还该被采纳。
 *
 * 只认最后一次发出的序号：先发的慢请求回来时序号已经落后，直接丢弃，
 * 否则用户已经改了关键词，屏幕上却会闪回上一个词的结果。
 */
export function isCurrent(responseSeq, latestSeq) {
  return responseSeq === latestSeq;
}

/** 搜索态是否应该接管发现页的画面（正文阅读时不接管）。 */
export function isSearchActive(state) {
  return state.phase !== 'idle';
}
