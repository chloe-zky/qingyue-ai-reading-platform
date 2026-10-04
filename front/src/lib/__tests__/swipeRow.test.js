import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  OPEN_WIDTH, startSwipe, moveSwipe, endSwipe,
} from '../swipeRow.js';

test('小幅抖动不锁定方向，也不动行', () => {
  const state = startSwipe(200, 300);
  const r = moveSwipe(state, 196, 302);
  assert.equal(r.axis, null);
  assert.equal(r.offset, 0);
  assert.equal(r.shouldPreventScroll, false);
});

test('明显横向 → 锁定 x，跟手左移并阻止页面滚动', () => {
  const state = startSwipe(200, 300);
  const r = moveSwipe(state, 160, 302);
  assert.equal(r.axis, 'x');
  assert.equal(r.offset, -40);
  assert.equal(r.shouldPreventScroll, true);
});

test('明显纵向 → 锁定 y，行归位，页面照常滚动', () => {
  const state = startSwipe(200, 300);
  const r = moveSwipe(state, 198, 260);
  assert.equal(r.axis, 'y');
  assert.equal(r.offset, 0);
  assert.equal(r.shouldPreventScroll, false);
});

test('方向一旦锁定就不再改变——手指抖动不会让行跟着纵滚漂移', () => {
  let { state } = moveSwipe(startSwipe(200, 300), 198, 250);   // 锁 y
  const r = moveSwipe(state, 120, 250);                        // 之后大幅横移
  assert.equal(r.axis, 'y');
  assert.equal(r.offset, 0);
});

test('左滑不超过删除按钮宽度，右滑不越过原位', () => {
  const state = startSwipe(200, 300);
  assert.equal(moveSwipe(state, -400, 300).offset, -OPEN_WIDTH);
  assert.equal(moveSwipe(state, 400, 300).offset, 0);
});

test('已展开的行以展开位为基准，右滑可收回', () => {
  const state = startSwipe(200, 300, true);
  assert.equal(state.offset, -OPEN_WIDTH);
  const r = moveSwipe(state, 260, 300);          // 右滑 60
  assert.equal(r.offset, -(OPEN_WIDTH - 60));
});

test('松手：过阈值停在展开位，不过则收回', () => {
  assert.equal(endSwipe(-OPEN_WIDTH), true);
  assert.equal(endSwipe(-OPEN_WIDTH * 0.5), true);
  assert.equal(endSwipe(-OPEN_WIDTH * 0.2), false);
  assert.equal(endSwipe(0), false);
});
