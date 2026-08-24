// decor.jsx — 线笔 SVG 装饰（逐字移植自原型 prototype/decor.jsx）。
// 纯 stroke，颜色继承 currentColor / color prop。作者中心只用到 Bird / FlyingBirds。

export function Bird({ size = 26, color = 'var(--ink-3)', style }) {
  return (
    <svg viewBox="0 0 48 40" width={size} height={(size * 40) / 48}
         fill="none" stroke={color} strokeWidth="1.4"
         strokeLinecap="round" strokeLinejoin="round" style={style}>
      {/* 身体 */}
      <path d="M10 26 C 10 16, 18 12, 26 14 C 33 15.5, 38 20, 42 18" />
      {/* 头 + 喙 */}
      <path d="M42 18 L 46 16.5 M42 18 C 40 15, 41 12, 43 11" />
      <circle cx="41" cy="15.5" r="0.8" fill={color} stroke="none" />
      {/* 翅膀 */}
      <path d="M20 15 C 22 8, 28 6, 32 9 C 28 11, 24 13, 22 16" />
      {/* 尾 */}
      <path d="M10 26 C 6 27, 4 29, 3 32 M10 26 C 7 29, 6 32, 6 35" />
      {/* 腿 */}
      <path d="M22 26 L 21 31 M27 26 L 27 31" />
    </svg>
  );
}

export function FlyingBirds({ size = 40, color = 'var(--ink-4)', style }) {
  return (
    <svg viewBox="0 0 80 40" width={size} height={(size * 40) / 80}
         fill="none" stroke={color} strokeWidth="1.3"
         strokeLinecap="round" style={style}>
      <path d="M6 20 C 12 12, 16 12, 22 20" />
      <path d="M30 12 C 37 3, 42 3, 49 12" />
      <path d="M54 24 C 59 17, 63 17, 68 24" />
    </svg>
  );
}
