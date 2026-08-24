// Icon.jsx — 内部后台线描图标集。
// 路径数据逐字移植自 prototype-admin/shared.jsx，未做任何简化或替换。
// 无第三方图标库：全部为内联 SVG，18×18 视口，描边取 currentColor 随主题变色。

const IP = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };

export default function Icon({ id, size = 18, style, className }) {
  const m = {
    // 平台管理员
    overview:  <g {...IP}><rect x="2.6" y="2.6" width="5.4" height="5.4" rx="1"/><rect x="10" y="2.6" width="5.4" height="5.4" rx="1"/><rect x="2.6" y="10" width="5.4" height="5.4" rx="1"/><rect x="10" y="10" width="5.4" height="5.4" rx="1"/></g>,
    llm:       <g {...IP}><path d="M9 2.4 3 5.1v4.4c0 3.6 2.6 5.9 6 7.1 3.4-1.2 6-3.5 6-7.1V5.1L9 2.4Z"/><path d="M6.5 9 8.2 10.7 11.6 7"/></g>,
    staff:     <g {...IP}><circle cx="7" cy="6.4" r="2.5"/><path d="M2.8 15c.5-2.5 2.3-3.9 4.2-3.9s3.7 1.4 4.2 3.9"/><path d="M12.2 4.3a2.4 2.4 0 0 1 0 4.5M13.4 14.7c-.2-1.6-1-2.9-2.1-3.6"/></g>,
    health:    <g {...IP}><path d="M2.6 9.2h3l1.6-4 2.6 8 1.7-4h3.9"/></g>,
    logs:      <g {...IP}><rect x="3.4" y="2.6" width="11.2" height="12.8" rx="1.4"/><path d="M6 6h6M6 9h6M6 12h3.6"/></g>,
    // 编辑部负责人
    quill:     <g {...IP}><path d="M15 3c-4 .4-7.4 2.6-9.2 6.2L4 13l3.8-1.8C11.4 9.4 13.6 6 14 2Z" transform="translate(.4 .6)"/><path d="M4 14.4 6.6 11.8"/></g>,
    prompt:    <g {...IP}><path d="M3 3.4h12v8.2H7.6L4.4 14V11.6H3V3.4Z"/><path d="M6 6.6h6M6 8.9h3.6"/></g>,
    tags:      <g {...IP}><path d="M3 3.4h5l7 7-4.6 4.6-7-7V3.4Z"/><circle cx="6.1" cy="6.5" r="1.1"/></g>,
    reco:      <g {...IP}><path d="M9 2.6 10.9 6.5 15.2 7.1 12.1 10.2 12.9 14.5 9 12.5 5.1 14.5 5.9 10.2 2.8 7.1 7.1 6.5 9 2.6Z"/></g>,
    sim:       <g {...IP}><circle cx="9" cy="9" r="6.4"/><path d="M9 5.2v3.8l2.6 1.6"/></g>,
    // ui
    check:     <g {...IP}><path d="M3.5 9.4 7 12.9 14.6 5.2"/></g>,
    plus:      <g {...IP}><path d="M9 3.6v10.8M3.6 9h10.8"/></g>,
    refresh:   <g {...IP}><path d="M14.5 4.6v3.4h-3.4M3.5 13.4V10h3.4"/><path d="M13.4 8a4.6 4.6 0 0 0-8-2.3L3.5 8M4.6 10a4.6 4.6 0 0 0 8 2.3L14.5 10"/></g>,
    warn:      <g {...IP}><path d="M9 2.8 16 15H2L9 2.8Z"/><path d="M9 7.4v3.4M9 12.8h.01"/></g>,
    lock:      <g {...IP}><rect x="3.8" y="8" width="10.4" height="7" rx="1.6"/><path d="M6 8V6.1a3 3 0 0 1 6 0V8"/></g>,
    key:       <g {...IP}><circle cx="6.4" cy="9" r="3"/><path d="M9.2 8.2h6.2v2.4M12.6 8.2v2.4"/></g>,
    bolt:      <g {...IP}><path d="M10 2.4 4 10h4l-1 5.6L13 8H9l1-5.6Z"/></g>,
    doc:       <g {...IP}><path d="M4.6 2.6h5.6L14 6.4v9H4.6V2.6Z"/><path d="M10 2.6V6.4h3.4"/></g>,
    bell:      <g {...IP}><path d="M9 3v1M5 8a4 4 0 0 1 8 0c0 3 1 4 1.4 4.6H3.6C4 12 5 11 5 8Z"/><path d="M7.4 14.6a1.7 1.7 0 0 0 3.2 0"/></g>,
    logout:    <g {...IP}><path d="M11 5.6V4a1.2 1.2 0 0 0-1.2-1.2H4.4A1.2 1.2 0 0 0 3.2 4v10a1.2 1.2 0 0 0 1.2 1.2h5.4A1.2 1.2 0 0 0 11 14v-1.6"/><path d="M8 9h7.4M13 6.6 15.6 9 13 11.4"/></g>,
    clock:     <g {...IP}><circle cx="9" cy="9" r="6.4"/><path d="M9 5.4V9l2.4 1.4"/></g>,
    copy:      <g {...IP}><rect x="6" y="6" width="8.4" height="8.4" rx="1.4"/><path d="M11.4 6V4.2A1.2 1.2 0 0 0 10.2 3H4.2A1.2 1.2 0 0 0 3 4.2v6a1.2 1.2 0 0 0 1.2 1.2H6"/></g>,
    download:  <g {...IP}><path d="M9 3v8M5.6 7.6 9 11l3.4-3.4M3.6 14.4h10.8"/></g>,
    eye:       <g {...IP}><path d="M1.8 9S4.4 4.4 9 4.4 16.2 9 16.2 9 13.6 13.6 9 13.6 1.8 9 1.8 9Z"/><circle cx="9" cy="9" r="2.1"/></g>,
    empty:     <g {...IP}><path d="M3 6.5 9 3l6 3.5v5L9 15l-6-3.5v-5Z"/><path d="M3 6.5 9 10l6-3.5M9 10v5"/></g>,
    forbidden: <g {...IP}><circle cx="9" cy="9" r="6.4"/><path d="M4.5 4.5l9 9"/></g>,
    plug:      <g {...IP}><path d="M6.4 3v3.4M11.6 3v3.4M4.8 6.4h8.4v2.2a4.2 4.2 0 0 1-8.4 0V6.4ZM9 12.8V15.4"/></g>,
    db:        <g {...IP}><ellipse cx="9" cy="4.6" rx="5.4" ry="2"/><path d="M3.6 4.6v8.8c0 1.1 2.4 2 5.4 2s5.4-.9 5.4-2V4.6M3.6 9c0 1.1 2.4 2 5.4 2s5.4-.9 5.4-2"/></g>,
    cloud:     <g {...IP}><path d="M5 13h7.5a3 3 0 0 0 .4-6A4.2 4.2 0 0 0 4.8 7.2 3 3 0 0 0 5 13Z"/></g>,
  };
  return (
    <svg viewBox="0 0 18 18" width={size} height={size} className={className} style={{ display: 'block', ...style }}>
      {m[id] || m.overview}
    </svg>
  );
}
