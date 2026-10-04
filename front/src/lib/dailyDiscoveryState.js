// dailyDiscoveryState.js — 发现页状态机的纯函数部分。
//
// 抽出来的原因是这块逻辑最容易出错，也最值得单测：什么时候进三步选择、
// 什么时候直接出结果、请求失败时绝不能被当成「新的一天」。React 组件里
// 混着 effect 很难验证，这里保持无副作用（唯一的例外是显式的旧 key 清理）。

export const LEGACY_DISCOVERY_KEY = 'reader.discoveryState.v1';

export const SELECTION_FIELDS = [
  'setting_tags',
  'story_tone_tags',
  'relationship_core_tags',
];

export function emptySelections() {
  return Object.fromEntries(SELECTION_FIELDS.map((field) => [field, []]));
}

export function cleanSelections(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(SELECTION_FIELDS.map((field) => [
    field,
    Array.isArray(source[field])
      ? source[field].filter((item) => typeof item === 'string').slice(0, 20)
      : [],
  ]));
}

/**
 * 把 /api/recommendations/daily 的响应压成一个视图状态。
 *
 * completed 是服务端按北京时间业务日给的结论，前端不再自行判断「今天」：
 *   completed:true  → 直接出结果，不闪一帧选择页
 *   completed:false → 进三步选择（新的一天、或今天还没选过）
 */
export function viewFromDailyState(payload) {
  const completed = payload?.completed === true;
  const selections = cleanSelections(payload?.selections);
  return {
    phase: completed ? 'list' : 'step',
    completed,
    selections,
    serverDate: typeof payload?.server_date === 'string' ? payload.server_date : '',
    articles: Array.isArray(payload?.results) ? payload.results : [],
    requestId: typeof payload?.request_id === 'string' ? payload.request_id : '',
    matchType: typeof payload?.match_type === 'string' ? payload.match_type : '',
    notice: typeof payload?.notice === 'string' ? payload.notice : '',
  };
}

/**
 * 请求失败 → 可重试错误态。
 *
 * 关键约束：失败绝不产出 phase:'step'。否则一次网络抖动会被当成「新的一天」，
 * 用户重新选完就把当天已保存的选择覆盖掉了。
 */
export function viewFromError(error) {
  return {
    phase: 'error',
    message: error?.detail || error?.message || '网络错误，请稍后重试',
  };
}

/**
 * 清理旧的无日期本地状态（reader.discoveryState.v1:<userId>）。
 *
 * 那个 key 没有日期，会把「昨天选过」永久当成「今天已完成」——正是这次要修的
 * 根因。切到服务端每日状态后它不再被读取，确认服务端状态后顺手删掉，避免
 * 用户设备上长期留一份会误导人的旧数据。
 */
export function forgetLegacyDiscoveryState(userId, storage) {
  if (!userId) return false;
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return false;
  try {
    store.removeItem(`${LEGACY_DISCOVERY_KEY}:${userId}`);
    return true;
  } catch {
    return false;   // 隐私模式下 storage 不可用，不影响主流程
  }
}
