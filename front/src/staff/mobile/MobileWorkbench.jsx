// MobileWorkbench.jsx — 手机端工作台外壳（大标题栏 + 内容 + 底部 tab bar）。
// 布局 / 类名逐字移植自 prototype-admin/mobile.jsx 的 MobileApp 主体部分。
//
// 与原型的差异，均为开发说明本身的要求或真实登录带来的必需：
// 1. 不含「预览角色 / 状态演示 / 演示账号」面板 —— §一 明确它们不属于生产界面。
// 2. 角色来自 GET /api/internal/me，不是本地 state；tab 表按角色取，
//    Comp 也从同一张表解析，跨角色访问在结构上不可能发生；另按 §四 再断言一次。
// 3. 落地补充：原型手机端没有任何退出登录入口（退出按钮在评审面板里）。
//    真实系统必须能登出，故在顶栏铃铛旁加一个 logout iconbtn，
//    沿用原型已有的 .mnav .iconbtn 结构与 Icon 图标集，不引入新组件。

import Icon from '../shared/Icon';
import { MNav } from './core';
import {
  MAdminHome, MAdminLLM, MAdminStaff, MAdminHealth, MAdminLogs,
  MLeadHome, MLeadPrompt, MLeadTags, MLeadReco, MLeadLogs,
  MReviewHome, MReviewHistory,
} from './screens';

// 三角色各自的 tab 表。不导出：跨角色访问必须走本表解析，外部拿不到别的角色的表。
const M_TABS = {
  admin: [
    { k: 'home', name: '概览', icon: 'overview', title: '技术概览', eb: '— Platform Overview —', Comp: MAdminHome },
    { k: 'llm', name: 'AI 配置', icon: 'llm', title: 'AI 服务配置', eb: '— AI Service —', Comp: MAdminLLM },
    { k: 'staff', name: '账号', icon: 'staff', title: '员工账号', eb: '— Staff Accounts —', Comp: MAdminStaff },
    { k: 'health', name: '状态', icon: 'health', title: '系统状态', eb: '— System Health —', Comp: MAdminHealth },
    { k: 'logs', name: '日志', icon: 'logs', title: '技术日志', eb: '— Technical Logs —', Comp: MAdminLogs },
  ],
  lead: [
    { k: 'home', name: '概览', icon: 'quill', title: '编辑策略概览', eb: '— Editorial Overview —', Comp: MLeadHome },
    { k: 'prompt', name: 'Prompt', icon: 'prompt', title: 'Prompt 管理', eb: '— Prompt Library —', Comp: MLeadPrompt },
    { k: 'tags', name: '词表', icon: 'tags', title: '标签词表', eb: '— Tag Lexicon —', Comp: MLeadTags },
    { k: 'reco', name: '推荐', icon: 'reco', title: '推荐策略', eb: '— Recommendation —', Comp: MLeadReco },
    { k: 'logs', name: '日志', icon: 'logs', title: '编辑配置日志', eb: '— Editorial Audit —', Comp: MLeadLogs },
  ],
  review: [
    { k: 'home', name: '审稿台', icon: 'doc', title: '审稿工作台', eb: '— Review Workspace —', Comp: MReviewHome },
    { k: 'history', name: '我的记录', icon: 'logs', title: '我的审稿记录', eb: '— My Reviews —', Comp: MReviewHistory },
  ],
};

export default function MobileWorkbench({ ctx, role, tab, setTab, signOut }) {
  const tabs = M_TABS[role] || [];
  const cur = tabs.find((t) => t.k === tab) || tabs[0];
  // §四 路由级守卫：当前 tab 必须属于本角色的 tab 表，否则不渲染任何页面。
  const permitted = Boolean(cur) && tabs.some((t) => t.k === cur.k);
  const Comp = permitted ? cur.Comp : null;

  return (
    <>
      <MNav
        large={cur?.title}
        eyebrow={cur?.eb}
        right={<>
          <button className="iconbtn" onClick={() => ctx.push('暂无新的通知', 'info')}><Icon id="bell" size={17} /><span className="dot" /></button>
          <button className="iconbtn" onClick={signOut} aria-label="退出登录"><Icon id="logout" size={17} /></button>
        </>}
      />
      <div key={role + tab} className="scroll slide-in" style={{ display: 'contents' }}>
        {Comp && <Comp ctx={ctx} />}
      </div>
      <div className="tabbar">
        {tabs.map((t) => (
          <button key={t.k} className={tab === t.k ? 'on' : ''} onClick={() => setTab(t.k)}>
            <Icon id={t.icon} size={22} /><span className="tb-t">{t.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}
