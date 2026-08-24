// useToasts.js — 全局 Toast 队列。
// 逻辑取自 prototype-admin/shared.jsx 的 useToasts，2600ms 自动消失不变。
// 单独放 .js：eslint react-refresh/only-export-components 要求 .jsx 只导出组件。

import { useCallback, useEffect, useRef, useState } from 'react';

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  // 组件卸载后清掉在途定时器，避免对已卸载组件 setState。
  const timers = useRef(new Set());
  useEffect(() => {
    const pending = timers.current;
    return () => { pending.forEach(clearTimeout); pending.clear(); };
  }, []);

  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text, kind }]);
    const timer = setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
      timers.current.delete(timer);
    }, 2600);
    timers.current.add(timer);
  }, []);

  return { toasts, push };
}
