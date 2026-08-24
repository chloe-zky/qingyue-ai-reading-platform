// EditorPage.jsx — 审稿编辑部入口（嵌入 StudioPage 的 .studio-embed）。
//
// 交付要求：电脑端与手机端呈现两套不同画面（各自逐屏移植原型）。
//   桌面（宽视口）→ EditorWeb   （顶栏 + 一页平铺卡片，配图/标签左右分栏）
//   手机（窄视口）→ EditorMobile（large-title 列表 + 详情 + 底部固定操作条）
//
// 两端共用 useEditorCore（同一后端接口、字段、词表、状态机），仅屏幕形态不同。
// 断点 820px：≤820 视为手机端。跨断点时数据（登录态/稿件）保存在 core 中不丢失。

import { useEffect, useState } from 'react';
import { useEditorCore } from './editor/useEditorCore';
import EditorWeb from './editor/EditorWeb';
import EditorMobile from './editor/EditorMobile';
import './editor/editor.css';

const MOBILE_QUERY = '(max-width: 820px)';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(MOBILE_QUERY).matches
      : false
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

export default function EditorPage({ staffSession = false, displayName = '编辑', onExit }) {
  const core = useEditorCore({ staffSession, displayName });
  const isMobile = useIsMobile();
  return isMobile
    ? <EditorMobile core={core} onExit={onExit} />
    : <EditorWeb core={core} onExit={onExit} />;
}
