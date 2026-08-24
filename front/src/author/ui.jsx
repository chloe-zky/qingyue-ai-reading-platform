// ui.jsx — 公共组件，逐字移植自原型 prototype/ui.jsx。
// 仅依赖 className（样式全在 author.css）；DOM 结构与类名与原型一致。
// 唯一工程化改动：FileDrop / CoverDrop 由 <image-slot> 演示替身换成真实的
// 隐藏 <input type=file> 控件，保留原型的 4 态视觉与类名。

import { useRef } from 'react';

export function TopNav({ brand = '编辑部', left, right, rule = true }) {
  return (
    <div className="topwrap" style={{ flex: '0 0 auto' }}>
      <div className="topnav">
        <div style={{ minWidth: 60, textAlign: 'left' }}>{left}</div>
        <div className="brand">{brand}</div>
        <div style={{ minWidth: 60, textAlign: 'right' }}>{right}</div>
      </div>
      {rule && <div className="topnav"><div className="rule" /></div>}
    </div>
  );
}

export function BackBtn({ onClick, label = '返回' }) {
  return <button className="back" onClick={onClick}>{label}</button>;
}

export function RightLink({ onClick, children }) {
  return <button className="right-link" onClick={onClick}>{children}</button>;
}

export function ProgressDots({ step = 1, total = 4 }) {
  const segs = [];
  for (let i = 0; i < total; i++) {
    segs.push(<span key={i} className={'seg' + (i < step ? ' on' : '')} />);
  }
  return (
    <div className="dots">
      <span className="ix">i</span>
      {segs}
      <span className="ix">{total === 4 ? 'iv' : 'v'}</span>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      {(label || hint) && (
        <div className="lbl">
          <span>{label}</span>
          {hint && <span className="hint">{hint}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

export function TextField({ label, hint, value, onChange, placeholder, type = 'text' }) {
  return (
    <Field label={label} hint={hint}>
      <input
        className="val"
        type={type}
        value={value || ''}
        placeholder={placeholder}
        onChange={(e) => onChange && onChange(e.target.value)}
      />
    </Field>
  );
}

export function AreaField({ label, hint, value, onChange, placeholder, paper = true, short = false }) {
  const cls = 'val' + (paper ? ' paper' : '') + (short ? ' short' : '');
  return (
    <Field label={label} hint={hint}>
      <textarea
        className={cls}
        value={value || ''}
        placeholder={placeholder}
        rows={paper ? 6 : 3}
        onChange={(e) => onChange && onChange(e.target.value)}
      />
    </Field>
  );
}

export function GentleNote({ accent = false, head, children }) {
  return (
    <div className={'gentle' + (accent ? ' accent' : '')}>
      {head && <span className="h">{head}</span>}
      {children}
    </div>
  );
}

export function BtnPrimary({ onClick, children, thin = false, disabled = false }) {
  return (
    <button className={'btn' + (thin ? ' thin' : '')}
            onClick={onClick}
            disabled={disabled}
            style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : null}>
      {children}
    </button>
  );
}

export function BtnGhost({ onClick, children, thin = false }) {
  return (
    <button className={'btn ghost' + (thin ? ' thin' : '')} onClick={onClick}>
      {children}
    </button>
  );
}

export function SegCtrl({ value, onChange, options }) {
  return (
    <div className="seg-ctrl">
      {options.map((o) => (
        <button key={o.value}
                className={value === o.value ? 'on' : ''}
                onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SectionH({ ko, children }) {
  return (
    <div className="section-h">
      {ko && <span className="ko">{ko}</span>}
      <span>{children}</span>
    </div>
  );
}
export function SectionSub({ children }) {
  return <p className="section-sub">{children}</p>;
}

export function Rubric({ children }) {
  return <div className="rubric"><span className="mk">§</span>{children}</div>;
}

export function StepHead({ n, total = 4, roman, title, sub }) {
  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 14 }}>
        <span className="folio">{String(n).padStart(2, '0')}<span className="of">/ {String(total).padStart(2, '0')}</span></span>
        <div style={{ flex: 1, paddingBottom: 4 }}>
          <div className="rubric" style={{ margin: 0 }}><span className="mk">§</span>{roman}</div>
        </div>
      </div>
      <h2>{title}</h2>
      <p className="sub">{sub}</p>
    </div>
  );
}

export function Seal({ children = '已 收 · 編 輯 部', big = false }) {
  return (
    <span className="seal" style={big ? { fontSize: 13, padding: '9px 11px 8px' } : null}>
      {children}
    </span>
  );
}

export function Masthead({ title = '编辑部 · 投稿存执', refCode }) {
  return (
    <div className="masthead">
      <span className="ttl">{title}</span>
      <span className="ref">{refCode}</span>
    </div>
  );
}

export function LedgerRow({ k, children, isStat, statKind = 'pend' }) {
  return (
    <div className="row">
      <span className="k">{k}</span>
      <span className="v">
        {isStat && <span className={'stat-dot ' + (statKind === 'active' ? '' : statKind)} />}
        {children}
      </span>
    </div>
  );
}

export function Perforation({ label = 'tear here · 副本撕口' }) {
  return (
    <div className="perf"><span className="lb">{label}</span></div>
  );
}

export function Trace({ items }) {
  return (
    <ul className="trace">
      {items.map((it, i) => (
        <li key={i} className={it.state}>
          <span className="t">{it.time || '—'}</span>
          <span className="what">{it.label}</span>
          {it.note && <div style={{ color: 'var(--ink-3)', fontSize: 12, marginTop: 4 }}>{it.note}</div>}
        </li>
      ))}
    </ul>
  );
}

export function StagesFeedback({ stages }) {
  return (
    <div className="stages">
      {stages.map((s, i) => (
        <div key={i} className={'stage ' + s.state}>
          <span className="mark" />
          <span className="what">
            {s.label}
            {s.code && <span className="code">{s.code}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function DraftFootnote({ time = '14:23', visible = true }) {
  if (!visible) return null;
  return (
    <div className="draft-foot">
      <span><span className="dot" />已留存于本机 · {time}</span>
      <span>草稿仅在本机</span>
    </div>
  );
}

// ── 人类可读文件大小 ──
function humanSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

// ── docx 附件（真实 <input type=file>，保留原型 4 态） ──
export function FileDrop({ file, onChoose, onRemove, onError, types = 'DOCX · 不超过 20MB', tag = 'Attachment', hint }) {
  const inputRef = useRef(null);

  const openPicker = () => inputRef.current && inputRef.current.click();

  const handlePick = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = ''; // 允许重复选同一文件
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) { onError && onError('文件超过 20MB'); return; }
    if (!f.name.toLowerCase().endsWith('.docx')) {
      onError && onError('目前仅支持 DOCX；旧版 DOC 请先另存为 DOCX');
      return;
    }
    onError && onError('');
    onChoose({ name: f.name, size: humanSize(f.size), progress: 0, rawFile: f });
  };

  const done = file && file.progress >= 1;
  const uploading = file && file.progress < 1;

  return (
    <div className={'file-drop' + (done ? ' has' : '')} onClick={!file ? openPicker : undefined}>
      <input ref={inputRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={handlePick} />
      <div className="row1">
        <span className="tag">{tag}</span>
        <span className="types">{types}</span>
      </div>
      {!file && (
        <div className="hint">
          {hint || <>轻点选择，或拖入 <span className="em">Word 文档</span>。<br/>整篇原稿一次性递交，编辑会按原始排版阅读。</>}
        </div>
      )}
      {uploading && (
        <>
          <div className="hint" style={{ color: 'var(--ink-3)' }}>{file.name} · {file.size} · 正在读取正文…</div>
          <div className="bar" style={{ '--remain': `${(1 - file.progress) * 100}%` }} />
        </>
      )}
      {done && (
        <>
          <div className="filename">
            <span className="icon" />
            <div style={{ flex: 1 }}>
              <div>{file.name}</div>
              <div className="size">{file.size} · 已读取 {file.characterCount || 0} 字</div>
            </div>
          </div>
          <div className="action">
            <button onClick={(e) => { e.stopPropagation(); openPicker(); }}>更换</button>
            <button className="danger" onClick={(e) => { e.stopPropagation(); onRemove && onRemove(); }}>移除</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── 封面图（真实 <input type=file image>，保留原型 filled 态） ──
export function CoverDrop({ cover, onChoose, onRemove }) {
  const inputRef = useRef(null);
  const openPicker = () => inputRef.current && inputRef.current.click();

  const handlePick = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    onChoose({ url: URL.createObjectURL(f), name: f.name });
  };

  return (
    <div className={'cover-drop' + (cover ? ' filled' : '')}
         onClick={!cover ? openPicker : undefined}
         style={cover && cover.url && cover.url !== 'placeholder'
           ? { backgroundImage: `url(${cover.url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
           : undefined}>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={handlePick} />
      <div className="row1" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="tag">Cover · 封面</span>
        <span className="types">JPG · PNG</span>
      </div>
      {!cover && <div className="center">轻点选择，或拖入一张图片</div>}
      {cover && (
        <button className="swap" onClick={(e) => { e.stopPropagation(); onRemove && onRemove(); }}>更 换</button>
      )}
    </div>
  );
}
