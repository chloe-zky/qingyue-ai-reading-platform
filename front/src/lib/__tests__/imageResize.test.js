import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_AVATAR_INPUT_BYTES, centerSquare, validateAvatarFile,
} from '../imageResize.js';

test('横图取中间那一段', () => {
  assert.deepEqual(centerSquare(1200, 800), { sx: 200, sy: 0, side: 800 });
});

test('竖图取中间那一段', () => {
  assert.deepEqual(centerSquare(800, 1200), { sx: 0, sy: 200, side: 800 });
});

test('方图原样不裁', () => {
  assert.deepEqual(centerSquare(500, 500), { sx: 0, sy: 0, side: 500 });
});

test('奇数差值也不会算出负偏移', () => {
  const { sx, sy, side } = centerSquare(101, 100);
  assert.equal(side, 100);
  assert.ok(sx >= 0 && sy >= 0);
});

test('校验：类型、体积、空文件各给可读文案', () => {
  assert.match(validateAvatarFile(null), /选择/);
  assert.match(validateAvatarFile({ type: 'image/gif', size: 100 }), /JPEG/);
  assert.match(
    validateAvatarFile({ type: 'image/png', size: MAX_AVATAR_INPUT_BYTES + 1 }),
    /体积/,
  );
});

test('合规图片通过校验', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.equal(validateAvatarFile({ type, size: 1024 }), '');
  }
});
