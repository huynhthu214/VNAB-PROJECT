import { useEffect, useRef, useState } from "react";
import { PROVINCES, fold, mergeLabel } from "../data.js";

/* ---------- biểu tượng (nét 1.8, lưới 24) ---------- */
const ICONS = {
  map: "M9 4 3 6.5v13L9 17l6 3 6-2.5v-13L15 7zM9 4v13M15 7v13",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  layers: "M12 3 3 8l9 5 9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5",
  book: "M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10",
  arrow: "M5 12h14M13 6l6 6-6 6",
  close: "M6 6l12 12M18 6L6 18",
  chevron: "m6 9 6 6 6-6",
  plus: "M12 5v14M5 12h14",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  pin: "M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  file: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 7.5v.5",
  check: "m5 12 5 5 9-10",
  merge: "M6 4v5a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V4M12 13v7",
  building: "M4 21V9l8-5 8 5v12M9 21v-6h6v6M3 21h18",
  sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  send: "M12 19V5M5 12l7-7 7 7",
  menu: "M4 7h16M4 12h16M4 17h16",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  alert: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5v5M12 16v.5",
  filter: "M4 5h16l-6 8v6l-4-2v-4z",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  copy: "M9 9h11v11H9zM5 15V4h11",
  refresh: "M20 11a8 8 0 0 0-14.5-3.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.5 3.5M20 20v-4.5h-4.5",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
};

export function Icon({ name, size = 18, stroke = 1.8, className, style }) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

export function SealMark({ size = 28 }) {
  return (
    <svg
      className="seal-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="32" cy="32" r="29" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="32" cy="32" r="22" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M20 36 L32 22 L44 36"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------- đếm số tăng dần (tôn trọng reduced-motion) ---------- */
export function CountUp({ value, duration = 900 }) {
  const [n, setN] = useState(value);
  const prev = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")
      .matches;
    if (reduce || !Number.isFinite(value)) {
      setN(value);
      return;
    }
    const from = prev.current;
    const t0 = performance.now();
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setN(Math.round(from + (value - from) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
      else prev.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{n.toLocaleString("vi-VN")}</>;
}

/* ---------- chọn tỉnh dạng chip ---------- */
export function ProvinceChips({ value, onChange, label = "Tỉnh/thành" }) {
  return (
    <div className="pchips" role="tablist" aria-label={label}>
      {PROVINCES.map((p) => (
        <button
          key={p.code}
          role="tab"
          aria-selected={p.code === value}
          className={`pchip ${p.code === value ? "on" : ""}`}
          style={{ "--c": p.color }}
          onClick={() => onChange(p.code)}
        >
          <span className="pchip-dot" />
          {p.name}
        </button>
      ))}
    </div>
  );
}

/* ---------- đoạn văn bản có tô sáng phần khớp (không phân biệt dấu) ---------- */
export function Highlight({ text, query }) {
  const t = String(text ?? "");
  const q = fold(query || "").trim();
  if (!q) return <>{t}</>;
  const ft = fold(t);
  const tokens = q.split(/\s+/).filter(Boolean);
  const marks = new Array(t.length).fill(false);
  for (const tok of tokens) {
    let from = 0;
    let at;
    while ((at = ft.indexOf(tok, from)) !== -1) {
      for (let i = at; i < at + tok.length; i++) marks[i] = true;
      from = at + tok.length;
    }
  }
  const out = [];
  let i = 0;
  while (i < t.length) {
    let j = i;
    while (j < t.length && marks[j] === marks[i]) j++;
    const seg = t.slice(i, j);
    out.push(marks[i] ? <mark key={i}>{seg}</mark> : seg);
    i = j;
  }
  return <>{out}</>;
}

export function MergeBadge({ merge }) {
  return (
    <span className={`mbadge ${merge === "mot_phan" ? "part" : "full"}`}>
      {mergeLabel(merge)}
    </span>
  );
}

/* ---------- sơ đồ "cũ → mới" ----------
   Các đơn vị cũ xếp dọc, nối bằng ngoặc vào một đơn vị mới. */
export function LineageFlow({ unit, query = "", hits }) {
  return (
    <div className="flow">
      <ul className="flow-old">
        {unit.oldUnits.map((o, i) => (
          <li key={i} className={hits?.has(i) ? "hit" : ""}>
            <div className="chip-old2">
              <span className="chip-old2-name">
                <Highlight text={o.name} query={query} />
              </span>
              <span className="chip-old2-sub">
                {o.parent ? <Highlight text={o.parent} query={query} /> : null}
              </span>
              <MergeBadge merge={o.merge} />
            </div>
          </li>
        ))}
      </ul>
      <span className="flow-mid" aria-hidden="true" />
      <div className="flow-new">
        <span className="flow-new-kind">{unit.newType || "Đơn vị mới"}</span>
        <span className="flow-new-name">
          <Highlight text={unit.newName} query={query} />
        </span>
      </div>
    </div>
  );
}

export function SampleNotice({ names }) {
  if (!names.length) return null;
  return (
    <div className="inline-notice" role="note">
      <Icon name="info" size={16} />
      <span>
        Dữ liệu của{" "}
        {names.length > 2
          ? `${names.slice(0, 2).join(", ")} và ${names.length - 2} tỉnh, thành khác`
          : names.join(", ")}{" "}
        hiện là dữ liệu minh họa, chưa phải ánh xạ pháp lý thật.
      </span>
    </div>
  );
}

export function LegalLink({ unit }) {
  if (unit.sample) return <span className="meta-dim">Dữ liệu minh họa</span>;
  if (!unit.decisionNumber) return <span className="meta-dim">Đang cập nhật</span>;
  const label = `NQ ${unit.decisionNumber}`;
  return unit.sourceUrl ? (
    <a
      className="meta-link"
      href={unit.sourceUrl}
      target="_blank"
      rel="noreferrer"
    >
      {label}
      <Icon name="external" size={13} />
    </a>
  ) : (
    <span>{label}</span>
  );
}
