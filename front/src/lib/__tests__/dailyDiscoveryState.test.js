// node --test 覆盖发现页状态机的纯函数部分。
// 仓库目前没有组件级测试环境（无 vitest/jsdom），所以把「什么时候进选择页、
// 什么时候直接出结果、失败时绝不进选择页」这几条产品语义抽成纯函数来验证。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_DISCOVERY_KEY,
  cleanSelections,
  emptySelections,
  forgetLegacyDiscoveryState,
  viewFromDailyState,
  viewFromError,
} from '../dailyDiscoveryState.js';

const completedPayload = {
  server_date: '2026-08-31',
  completed: true,
  selections: {
    setting_tags: ['现代'],
    story_tone_tags: ['温暖治愈'],
    relationship_core_tags: [],
  },
  request_id: 'req-1',
  results: [{ book_id: 1, title: '春日' }],
  match_type: 'exact',
  notice: '',
};

test('今日已有状态 → 直接进结果页，不经过选择页', () => {
  const view = viewFromDailyState(completedPayload);
  assert.equal(view.phase, 'list');
  assert.equal(view.completed, true);
  assert.deepEqual(view.selections.setting_tags, ['现代']);
  assert.equal(view.articles.length, 1);
  assert.equal(view.requestId, 'req-1');
  assert.equal(view.serverDate, '2026-08-31');
});

test('今日没有状态 → 进三步选择，且不带上任何历史选择', () => {
  const view = viewFromDailyState({
    server_date: '2026-09-01',
    completed: false,
    selections: emptySelections(),
    results: [],
  });
  assert.equal(view.phase, 'step');
  assert.equal(view.completed, false);
  assert.deepEqual(view.selections, emptySelections());
  assert.deepEqual(view.articles, []);
});

test('接近匹配的提示原样带到视图上', () => {
  const view = viewFromDailyState({
    ...completedPayload,
    match_type: 'closest',
    notice: '暂无完全匹配你选择的作品，以下是更接近的几篇。',
  });
  assert.equal(view.matchType, 'closest');
  assert.match(view.notice, /更接近/);
});

test('请求失败 → 可重试错误态，绝不产出选择页', () => {
  const view = viewFromError({ detail: '无法连接服务器' });
  assert.equal(view.phase, 'error');
  assert.equal(view.message, '无法连接服务器');
  assert.notEqual(view.phase, 'step');
});

test('失败对象没有 detail 时回落到通用文案', () => {
  assert.equal(viewFromError(new Error('boom')).message, 'boom');
  assert.match(viewFromError(null).message, /重试/);
});

test('completed 只认严格 true，缺字段/脏数据一律当没选过', () => {
  for (const payload of [null, undefined, {}, { completed: 'true' }, { completed: 1 }]) {
    assert.equal(viewFromDailyState(payload).phase, 'step');
  }
});

test('选择内容做清洗：非字符串剔除、上限 20、缺失维度补空', () => {
  const cleaned = cleanSelections({
    setting_tags: ['现代', 42, null, '古风'],
    story_tone_tags: Array.from({ length: 30 }, (_, i) => `t${i}`),
  });
  assert.deepEqual(cleaned.setting_tags, ['现代', '古风']);
  assert.equal(cleaned.story_tone_tags.length, 20);
  assert.deepEqual(cleaned.relationship_core_tags, []);
});

test('确认服务端状态后删除旧的无日期本地状态', () => {
  const removed = [];
  const storage = { removeItem: (key) => removed.push(key) };

  assert.equal(forgetLegacyDiscoveryState('user-1', storage), true);
  assert.deepEqual(removed, [`${LEGACY_DISCOVERY_KEY}:user-1`]);
});

test('匿名（无 userId）不碰本地存储', () => {
  const storage = {
    removeItem: () => { throw new Error('anonymous must not touch storage'); },
  };
  assert.equal(forgetLegacyDiscoveryState('', storage), false);
});

test('storage 不可用时不抛错，主流程不受影响', () => {
  const storage = {
    removeItem: () => { throw new Error('private mode'); },
  };
  assert.equal(forgetLegacyDiscoveryState('user-1', storage), false);
});

test('旧的无日期本地状态只会被删除，永远不会被读回来', async () => {
  // 根因是旧实现读 reader.discoveryState.v1:<userId>：它没有日期，
  // 「昨天选过」会被永久当成「今天已完成」。新模块只提供删除入口，
  // 没有任何读取旧 key 的导出；读到 getItem 就说明回归了。
  const touched = [];
  const storage = {
    getItem: () => { throw new Error('legacy state must never be read'); },
    removeItem: (key) => touched.push(key),
  };
  forgetLegacyDiscoveryState('user-1', storage);
  assert.deepEqual(touched, [`${LEGACY_DISCOVERY_KEY}:user-1`]);

  const moduleExports = await import('../dailyDiscoveryState.js');
  const readers = Object.keys(moduleExports).filter((name) => /^(load|read|restore)/.test(name));
  assert.deepEqual(readers, []);
});
