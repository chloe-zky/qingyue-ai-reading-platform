// preview.jsx — 内部后台开发期预览入口（不进生产构建）。
//
// InternalApp 尚未挂载到 App.jsx / StudioPage.jsx（那两处属于现有视觉页面），
// 但设计本身需要能被完整走查。这个独立入口只做这件事：
//   npm run dev → http://localhost:5173/src/staff/preview.html
//
// 生产构建入口是 front/index.html，不引用本文件，因此不会被打包。

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import InternalApp from './InternalApp';

createRoot(document.getElementById('staff-preview-root')).render(
  <StrictMode>
    <InternalApp />
  </StrictMode>
);
