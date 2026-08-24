// dicts.js — 手机端状态字典，逐字取自 prototype-admin/mobile-core.jsx。
// 单独放 .js：eslint react-refresh/only-export-components 要求 .jsx 只导出组件。
// 取值与桌面端 shared/constants.js 的 STAFF_STATUS / PROMPT_STATUS 一致。

export const M_STAFF = { active: ['ok', '在用'], invited: ['info', '待接受'], disabled: ['mute', '已禁用'] };
export const M_PROMPT = { draft: ['warn', '草稿'], testing: ['info', '测试中'], published: ['ok', '已发布'], disabled: ['mute', '已停用'] };
