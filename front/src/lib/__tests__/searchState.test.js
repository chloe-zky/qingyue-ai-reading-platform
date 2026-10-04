import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_QUERY_LENGTH,
  errorSearch, idleSearch, isCurrent, isSearchActive, isSearchable,
  loadingSearch, normalizeQuery, resultsSearch,
} from '../searchState.js';

test('归一化：去首尾空格、压缩空白、砍通配符、限长', () => {
  assert.equal(normalizeQuery('  倾城  '), '倾城');
  assert.equal(normalizeQuery('绿亦歌   短篇'), '绿亦歌 短篇');
  assert.equal(normalizeQuery('倾%城_之*恋'), '倾城之恋');
  assert.equal(normalizeQuery('字'.repeat(200)).length, MAX_QUERY_LENGTH);
  assert.equal(normalizeQuery(null), '');
});

test('只剩通配符或空白时不算可搜索——不能退化成匹配全部', () => {
  for (const raw of ['', '   ', '%', '***', '_', null, undefined]) {
    assert.equal(isSearchable(raw), false, String(raw));
  }
  assert.equal(isSearchable('倾'), true);
});

test('有结果与无结果是两种状态，无结果带可读文案', () => {
  const hit = resultsSearch('倾城', [{ book_id: 1 }]);
  assert.equal(hit.phase, 'results');
  assert.equal(hit.message, '');

  const miss = resultsSearch('张三', []);
  assert.equal(miss.phase, 'empty');
  assert.match(miss.message, /张三/);
});

test('非数组响应按无结果处理，不会把界面打崩', () => {
  assert.equal(resultsSearch('倾城', null).phase, 'empty');
  assert.equal(resultsSearch('倾城', undefined).results.length, 0);
});

test('错误态保留关键词并给出可读信息', () => {
  const state = errorSearch('倾城', { detail: '无法连接服务器' });
  assert.equal(state.phase, 'error');
  assert.equal(state.query, '倾城');
  assert.equal(state.message, '无法连接服务器');
  assert.match(errorSearch('倾城', null).message, /重试/);
});

test('竞态：只采纳最后一次请求的结果', () => {
  // 用户打了「倾」再打「倾城」，「倾」的慢响应回来时必须被丢弃。
  assert.equal(isCurrent(1, 2), false);
  assert.equal(isCurrent(2, 2), true);
});

test('idle 不接管发现页，其余状态都接管', () => {
  assert.equal(isSearchActive(idleSearch()), false);
  assert.equal(isSearchActive(loadingSearch('倾城')), true);
  assert.equal(isSearchActive(resultsSearch('倾城', [{ book_id: 1 }])), true);
  assert.equal(isSearchActive(resultsSearch('张三', [])), true);
  assert.equal(isSearchActive(errorSearch('倾城', {})), true);
});

test('清空回到 idle：不带关键词、不带结果，发现页原样恢复', () => {
  const state = idleSearch();
  assert.deepEqual(state, { phase: 'idle', query: '', results: [], message: '' });
});
