import { useMemo, useState } from "react";
import { MAP } from "../mapData.js";
import { PROVINCES, provinceByCode, oldProvinceList } from "../data.js";
import { Icon, CountUp } from "./shared.jsx";

const canHover = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;

/* ---------- bản đồ SVG ---------- */
function SouthMap({ activeCode, selectedCode, onHover, onActivate }) {
  const [W, H] = MAP.viewBox;
  // tỉnh đang được trỏ vẽ sau cùng để viền không bị tỉnh khác che
  const order = useMemo(() => {
    const rest = PROVINCES.filter((p) => p.code !== activeCode);
    const top = PROVINCES.filter((p) => p.code === activeCode);
    return [...rest, ...top];
  }, [activeCode]);

  return (
    <svg
      className="south-map"
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label="Bản đồ 8 tỉnh, thành phố miền Nam sau sáp nhập"
    >
      <path className="map-ctx" d={MAP.context} />
      <text className="map-sea" x={MAP.places.bienDong[0]} y={MAP.places.bienDong[1]}>
        Biển Đông
      </text>
      <text className="map-sea" x={MAP.places.vinhThaiLan[0] + 14} y={MAP.places.vinhThaiLan[1]}>
        Vịnh Thái Lan
      </text>
      <text className="map-land" x={MAP.places.campuchia[0] + 10} y={MAP.places.campuchia[1]}>
        Campuchia
      </text>

      {order.map((p) => {
        const geo = MAP.provinces[p.code];
        const on = activeCode === p.code;
        const sel = selectedCode === p.code;
        return (
          <g
            key={p.code}
            className={`mp ${on ? "on" : ""} ${sel ? "sel" : ""}`}
            style={{ "--c": p.color }}
            tabIndex={0}
            role="button"
            aria-label={`${p.name}, hợp nhất từ ${p.merged}`}
            onMouseEnter={() => onHover(p.code)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(p.code)}
            onBlur={() => onHover(null)}
            onClick={() => onActivate(p.code)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onActivate(p.code);
              }
            }}
          >
            {geo.old.map((o) => (
              <path key={o.code} className="mp-old" d={o.d} />
            ))}
            <path className="mp-out" d={geo.d} />
          </g>
        );
      })}

      {PROVINCES.map((p) => {
        const [x, y] = MAP.provinces[p.code].label;
        return (
          <text
            key={p.code}
            className={`mp-label ${activeCode === p.code ? "on" : ""}`}
            x={x}
            y={y}
            textAnchor="middle"
          >
            {p.short}
          </text>
        );
      })}
    </svg>
  );
}

/* ---------- bảng thông tin bên cạnh bản đồ ---------- */
function MapPanel({ code, stats, onHover, onActivate, actions }) {
  const p = code ? provinceByCode(code) : null;
  const s = p ? stats.perProvince[p.code] : null;
  return (
    <aside className="map-panel" aria-live="polite">
      {p ? (
        <div className="mp-detail" style={{ "--c": p.color }} key={p.code}>
          <span className="mp-detail-bar" />
          <h3>{p.name}</h3>
          <p className="mp-detail-sub">Hợp nhất từ</p>
          <div className="lineage">
            <div className="lineage-old">
              {oldProvinceList(p).map((x) => (
                <span key={x} className="chip-old">
                  {x}
                </span>
              ))}
            </div>
            <span className="lineage-arrow" aria-hidden="true">
              <Icon name="arrow" size={20} />
            </span>
            <span className="chip-new">
              {p.name}
            </span>
          </div>
          <dl className="mp-nums">
            <div>
              <dt>Đơn vị cấp xã mới</dt>
              <dd>{s.newUnits.toLocaleString("vi-VN")}</dd>
            </div>
            <div>
              <dt>Đơn vị cấp xã cũ</dt>
              <dd>{s.oldUnits.toLocaleString("vi-VN")}</dd>
            </div>
          </dl>
          <div className="mp-actions">
            <button className="btn primary" onClick={() => actions.lookup(p.code)}>
              <Icon name="search" size={16} />
              Tra cứu
            </button>
            <button className="btn" onClick={() => actions.explore(p.code)}>
              <Icon name="layers" size={16} />
              Khám phá
            </button>
            <button className="btn" onClick={() => actions.chat(p.code)}>
              <Icon name="chat" size={16} />
              Hỏi đáp
            </button>
          </div>
        </div>
      ) : (
        <div className="mp-intro">
          <h3>8 tỉnh, thành phố</h3>
          <p>Di chuột (hoặc chạm) vào bản đồ để xem tỉnh mới hợp nhất từ những tỉnh nào.</p>
          <ul className="mp-rows">
            {PROVINCES.map((q) => (
              <li key={q.code}>
                <button
                  style={{ "--c": q.color }}
                  onMouseEnter={() => onHover(q.code)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(q.code)}
                  onBlur={() => onHover(null)}
                  onClick={() => onActivate(q.code)}
                >
                  <span className="swatch" />
                  <strong>{q.short}</strong>
                  <span className="mp-rows-from">
                    {oldProvinceList(q).filter((x) => x !== q.short && x !== q.name).join(", ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {p && (
        <ul className="mp-legend" aria-label="Danh sách tỉnh, thành phố">
          {PROVINCES.map((q) => (
            <li key={q.code}>
              <button
                className={q.code === code ? "on" : ""}
                style={{ "--c": q.color }}
                onMouseEnter={() => onHover(q.code)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(q.code)}
                onBlur={() => onHover(null)}
                onClick={() => onActivate(q.code)}
              >
                <span className="swatch" />
                {q.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

const STAT_DEFS = [
  { key: "provinces", icon: "map", label: "Tỉnh, thành phố", sub: (s) => `hợp nhất từ ${s.oldProvinces} tỉnh, thành cũ` },
  { key: "oldUnits", icon: "building", label: "Đơn vị cấp xã cũ", sub: () => "trước sắp xếp" },
  { key: "newUnits", icon: "merge", label: "Đơn vị cấp xã mới", sub: () => "phường, xã, đặc khu" },
  { key: "docs", icon: "file", label: "Văn bản căn cứ", sub: () => "nghị quyết được dẫn nguồn" },
];

export default function OverviewTab({ stats, loading, actions, onHeroSearch }) {
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);
  const [q, setQ] = useState("");
  const active = hover || selected;

  function activate(code) {
    if (canHover()) actions.lookup(code);
    else setSelected(code); // màn hình cảm ứng: chạm lần đầu để xem, nút trong bảng để đi tiếp
  }

  return (
    <div className="page ov">
      <section className="ov-hero">
        <svg className="hero-art" viewBox={`0 0 ${MAP.viewBox[0]} ${MAP.viewBox[1]}`} aria-hidden="true">
          {PROVINCES.map((p) => (
            <path key={p.code} d={MAP.provinces[p.code].d} />
          ))}
        </svg>
        <div className="wrap">
          <span className="eyebrow">
            <Icon name="spark" size={14} />
            Sắp xếp đơn vị hành chính 2025
          </span>
          <h1>
            Tra cứu địa giới hành chính <em>miền Nam</em> sau sáp nhập
          </h1>
          <p className="lead">
            Phường, xã cũ nay thuộc đơn vị nào? Tìm nhanh trong 8 tỉnh, thành
            phố, mỗi kết quả đều kèm căn cứ pháp lý để đối chiếu.
          </p>
          <form
            className="hero-search"
            onSubmit={(e) => {
              e.preventDefault();
              onHeroSearch(q.trim());
            }}
          >
            <Icon name="search" size={20} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nhập tên phường, xã cũ, ví dụ: Bến Nghé"
              aria-label="Tìm phường, xã"
            />
            <button className="btn primary" type="submit">
              Tra cứu
            </button>
          </form>
        </div>
      </section>

      <div className="wrap ov-body">
        <section className="stats" aria-label="Số liệu tổng quan">
          {STAT_DEFS.map((d) => (
            <div className="stat" key={d.key}>
              <span className="stat-icon">
                <Icon name={d.icon} size={20} />
              </span>
              <div>
                <div className="stat-num">
                  {loading ? "—" : <CountUp value={stats[d.key]} />}
                </div>
                <div className="stat-label">{d.label}</div>
                <div className="stat-sub">{d.sub(stats)}</div>
              </div>
            </div>
          ))}
        </section>

        <section className="map-card" aria-label="Bản đồ">
          <div className="map-stage">
            <SouthMap
              activeCode={active}
              selectedCode={selected}
              onHover={setHover}
              onActivate={activate}
            />
          </div>
          <MapPanel
            code={active}
            stats={stats}
            onHover={setHover}
            onActivate={activate}
            actions={actions}
          />
        </section>

        <section className="feat" aria-label="Chức năng">
          <button className="feat-card" onClick={actions.goLookup}>
            <span className="feat-icon">
              <Icon name="search" size={22} />
            </span>
            <h3>Tra cứu nhanh</h3>
            <p>Gõ tên phường, xã cũ hoặc mới để xem sơ đồ chuyển đổi tức thì.</p>
            <span className="feat-go">
              Mở tra cứu <Icon name="arrow" size={16} />
            </span>
          </button>
          <button className="feat-card" onClick={actions.goExplore}>
            <span className="feat-icon">
              <Icon name="layers" size={22} />
            </span>
            <h3>Khám phá theo tỉnh</h3>
            <p>Duyệt toàn bộ đơn vị mới của một tỉnh và xem được hình thành từ đâu.</p>
            <span className="feat-go">
              Mở khám phá <Icon name="arrow" size={16} />
            </span>
          </button>
          <button className="feat-card" onClick={actions.goChat}>
            <span className="feat-icon">
              <Icon name="chat" size={22} />
            </span>
            <h3>Hỏi đáp</h3>
            <p>Đặt câu hỏi bằng ngôn ngữ tự nhiên, nhận câu trả lời kèm nguồn.</p>
            <span className="feat-go">
              Bắt đầu hỏi <Icon name="arrow" size={16} />
            </span>
          </button>
        </section>
      </div>
    </div>
  );
}
