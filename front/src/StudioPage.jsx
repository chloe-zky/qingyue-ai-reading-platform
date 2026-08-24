// StudioPage.jsx — 轻阅读内部后台的唯一入口。
//
// 旧版「审稿编辑部」与「系统配置」使用共享 admin-token，已经被三角色
// Supabase Auth + 后端 RBAC 体系取代。这里不再暴露两套并行入口；审稿详情
// 由 InternalApp 在 review_editor 的已登录会话内打开。

import InternalApp from './staff/InternalApp';
import './StudioPage.css';

export default function StudioPage({ onExit }) {
  return (
    <div className="studio-root">
      <div className="studio-subnav">
        <button className="studio-back" onClick={onExit}>
          ← 返回进入页
        </button>
      </div>
      <div className="studio-embed">
        <InternalApp />
      </div>
    </div>
  );
}
