// swipeRow.js — 列表行左滑手势的纯逻辑。
//
// 抽出来是因为这块最容易出错：手势要在「横向滑动」和「纵向滚动」之间做取舍，
// 判早了会把列表滚动卡住，判晚了会滑不出来。放在纯函数里能直接断言，
// 不必真的在页面上甩手指。

export const OPEN_WIDTH = 88;      // 删除按钮露出的宽度，与 CSS 保持一致
const DIRECTION_LOCK = 8;          // 超过这个位移才判定主方向
const DIRECTION_RATIO = 1.2;       // 横向要明显大于纵向才算横滑
const OPEN_THRESHOLD = OPEN_WIDTH * 0.45;   // 松手后是否停在展开位

/** 手势起始状态。axis 为 null 表示主方向还没定。 */
export function startSwipe(x, y, wasOpen = false) {
  return { startX: x, startY: y, axis: null, offset: wasOpen ? -OPEN_WIDTH : 0, wasOpen };
}

/**
 * 处理一次移动。返回 { state, offset, axis, shouldPreventScroll }。
 *
 * 主方向一旦锁定就不再改变：否则手指稍微抖一下，行会跟着纵向滚动一起漂。
 */
export function moveSwipe(state, x, y) {
  const dx = x - state.startX;
  const dy = y - state.startY;
  let axis = state.axis;

  if (axis === null) {
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX < DIRECTION_LOCK && absY < DIRECTION_LOCK) {
      return { state, offset: state.offset, axis: null, shouldPreventScroll: false };
    }
    axis = absX > absY * DIRECTION_RATIO ? 'x' : 'y';
  }

  if (axis === 'y') {
    // 纵向滚动：把行放回原位，让页面正常滚。
    return {
      state: { ...state, axis },
      offset: state.wasOpen ? -OPEN_WIDTH : 0,
      axis,
      shouldPreventScroll: false,
    };
  }

  const base = state.wasOpen ? -OPEN_WIDTH : 0;
  // 只允许向左拉开；右滑最多回到 0，再往右不跟手（避免露出右侧空白）。
  const offset = Math.max(-OPEN_WIDTH, Math.min(0, base + dx));
  return { state: { ...state, axis }, offset, axis, shouldPreventScroll: true };
}

/** 松手：越过阈值就停在展开位，否则收回。 */
export function endSwipe(offset) {
  return offset <= -OPEN_THRESHOLD;
}
