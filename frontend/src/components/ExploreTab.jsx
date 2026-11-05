import { useEffect, useMemo, useState } from "react";
import {
  PROVINCES,
  provinceByCode,
  oldProvinceList,
  fold,
  formatDate,
} from "../data.js";
import {
  Icon,
  ProvinceChips,
  LineageFlow,
  LegalLink,
  SampleNotice,
} from "./shared.jsx";

const MANY = 4; // ngưỡng "gộp từ nhiều đơn vị cũ"
const PAGE = 60;

const SORTS = [
  { value: "name", label: "Tên A → Z" },
  { value: "most", label: "Gộp nhiều đơn vị cũ nhất" },
];

function UnitRow({ unit, open, onToggle, onAsk }) {
  const n = unit.oldUnits.length;
  const partial = unit.oldUnits.some((o) => o.merge === "mot_phan");
  return (
    <li className={`erow ${open ? "open" : ""}`}>
      <button
        className="erow-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="erow-name">
          {unit.newType && <span className="erow-kind">{unit.newType}</span>}
          {unit.newName.replace(/^(Phường|Xã|Thị trấn|Đặc khu)\s+/i, "")}
        </span>
        <span className="erow-tags">
          {partial && <span className="mbadge part">Có phần một phần</span>}
          <span className="erow-count">
            {n === 1 ? "1 đơn vị cũ" : `${n} đơn vị cũ`}
          </span>
        </span>
        <Icon name="chevron" size={18} className="erow-chev" />
      </button>
      {open && (
        <div className="erow-body">
          <p className="erow-cap">Được hình thành từ</p>
          <LineageFlow unit={unit} />
          <ul className="meta">
            {unit.hq && (
              <li>
                <Icon name="pin" size={15} />
                <span>{unit.hq}</span>
              </li>
            )}
            <li>
              <Icon name="file" size={15} />
              <span>
                Căn cứ: <LegalLink unit={unit} />
                {unit.decisionDate && !unit.sample
                  ? `, ${formatDate(unit.decisionDate)}`
                  : ""}
              </span>
            </li>
          </ul>
          <button
            className="link-btn"
            onClick={() =>
              onAsk(
                unit.province,
                `${unit.newName} được hình thành từ những đơn vị nào?`,
              )
            }
          >
            Hỏi thêm về đơn vị này <Icon name="arrow" size={15} />
          </button>
        </div>
      )}
    </li>
  );
}

export default function ExploreTab({
  units,
  loading,
  province,
  onProvince,
  onAsk,
}) {
  const p = provinceByCode(province);
  const [q, setQ] = useState("");
  const [onlyPartial, setOnlyPartial] = useState(false);
  const [onlyMany, setOnlyMany] = useState(false);
  const [sort, setSort] = useState("name");
  const [openIds, setOpenIds] = useState(() => new Set());
  const [limit, setLimit] = useState(PAGE);

  // đổi tỉnh hoặc bộ lọc → về đầu danh sách
  useEffect(() => {
    setOpenIds(new Set());
    setLimit(PAGE);
  }, [province, q, onlyPartial, onlyMany, sort]);

  const provUnits = useMemo(
    () => units.filter((u) => u.province === province),
    [units, province],
  );

  const totals = useMemo(() => {
    let old = 0;
    let part = 0;
    let many = 0;
    for (const u of provUnits) {
      old += u.oldUnits.length;
      if (u.oldUnits.some((o) => o.merge === "mot_phan")) part++;
      if (u.oldUnits.length >= MANY) many++;
    }
    return { new: provUnits.length, old, part, many };
  }, [provUnits]);

  const list = useMemo(() => {
    const fq = fold(q).trim();
    let r = provUnits.filter((u) => {
      if (onlyPartial && !u.oldUnits.some((o) => o.merge === "mot_phan")) return false;
      if (onlyMany && u.oldUnits.length < MANY) return false;
      if (fq) {
        const hay = [u.newName, ...u.oldUnits.map((o) => o.name)]
          .map(fold)
          .join(" | ");
        if (!fq.split(/\s+/).every((t) => hay.includes(t))) return false;
      }
      return true;
    });
    r = [...r].sort((a, b) =>
      sort === "most"
        ? b.oldUnits.length - a.oldUnits.length ||
          a.newName.localeCompare(b.newName, "vi")
        : a.newName.localeCompare(b.newName, "vi", { numeric: true }),
    );
    return r;
  }, [provUnits, q, onlyPartial, onlyMany, sort]);

  function toggle(id) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const sample = provUnits.some((u) => u.sample) ? [p.name] : [];
  const filtered = q || onlyPartial || onlyMany;

  return (
    <div className="page ex">
      <div className="wrap">
        <header className="page-head">
          <h1>Khám phá theo tỉnh</h1>
          <p>
            Chọn một tỉnh, thành phố để duyệt các đơn vị cấp xã mới và xem mỗi
            đơn vị được hình thành từ những đơn vị cũ nào.
          </p>
        </header>

        <div className="ex-chips">
          <ProvinceChips value={province} onChange={onProvince} />
        </div>

        <div className="ex-grid">
          <nav className="ex-side" aria-label="Chọn tỉnh, thành phố">
            {PROVINCES.map((x) => (
              <button
                key={x.code}
                className={x.code === province ? "on" : ""}
                style={{ "--c": x.color }}
                onClick={() => onProvince(x.code)}
                aria-current={x.code === province ? "true" : undefined}
              >
                <span className="swatch" />
                <span className="ex-side-name">{x.name}</span>
                <span className="ex-side-n">
                  {units.filter((u) => u.province === x.code).length}
                </span>
              </button>
            ))}
          </nav>

          <section className="ex-main" aria-live="polite" style={{ "--c": p.color }}>
            <div className="ex-head" style={{ "--c": p.color }}>
              <span className="ex-head-bar" />
              <div className="ex-head-top">
                <h2>{p.name}</h2>
                <div className="lineage">
                  <div className="lineage-old">
                    {oldProvinceList(p).map((x) => (
                      <span key={x} className="chip-old">
                        {x}
                      </span>
                    ))}
                  </div>
                  <span className="lineage-arrow" aria-hidden="true">
                    <Icon name="arrow" size={18} />
                  </span>
                  <span className="chip-new">
                    {p.name}
                  </span>
                </div>
              </div>
              <dl className="ex-nums">
                <div>
                  <dt>Đơn vị cấp xã mới</dt>
                  <dd>{totals.new.toLocaleString("vi-VN")}</dd>
                </div>
                <div>
                  <dt>Đơn vị cấp xã cũ</dt>
                  <dd>{totals.old.toLocaleString("vi-VN")}</dd>
                </div>
                <div>
                  <dt>Nhận một phần</dt>
                  <dd>{totals.part.toLocaleString("vi-VN")}</dd>
                </div>
              </dl>
            </div>

            <SampleNotice names={sample} />

            <div className="filters">
              <div className="search-box compact">
                <Icon name="search" size={18} />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={`Lọc trong ${p.name}...`}
                  aria-label="Lọc đơn vị"
                />
                {q && (
                  <button
                    className="icon-btn"
                    aria-label="Xóa bộ lọc tên"
                    onClick={() => setQ("")}
                  >
                    <Icon name="close" size={15} />
                  </button>
                )}
              </div>
              <button
                className={`toggle ${onlyMany ? "on" : ""}`}
                aria-pressed={onlyMany}
                onClick={() => setOnlyMany((v) => !v)}
              >
                <Icon name={onlyMany ? "check" : "merge"} size={15} />
                Gộp từ {MANY}+ đơn vị cũ
              </button>
              <button
                className={`toggle ${onlyPartial ? "on" : ""}`}
                aria-pressed={onlyPartial}
                onClick={() => setOnlyPartial((v) => !v)}
              >
                <Icon name={onlyPartial ? "check" : "filter"} size={15} />
                Chỉ nhận một phần
              </button>

            </div>

            {loading ? (
              <div className="skeleton-list" aria-hidden="true">
                <div className="skeleton" />
                <div className="skeleton" />
                <div className="skeleton" />
              </div>
            ) : list.length === 0 ? (
              <div className="lk-empty small">
                <h2>Không có đơn vị nào khớp</h2>
                <p>
                  {filtered
                    ? "Hãy nới lỏng bộ lọc hoặc xóa từ khóa."
                    : "Chưa có dữ liệu đơn vị cho tỉnh này."}
                </p>
                {filtered && (
                  <button
                    className="btn"
                    onClick={() => {
                      setQ("");
                      setOnlyMany(false);
                      setOnlyPartial(false);
                    }}
                  >
                    Xóa bộ lọc
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="count-row">
                  <p className="result-count">
                    {list.length.toLocaleString("vi-VN")} đơn vị
                    {filtered ? " khớp bộ lọc" : ""}
                  </p>
              <label className="select-pill small">
                <span>Sắp xếp</span>
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <Icon name="chevron" size={15} />
              </label>
                </div>
                <ul className="elist">
                  {list.slice(0, limit).map((u) => (
                    <UnitRow
                      key={u.id}
                      unit={u}
                      open={openIds.has(u.id)}
                      onToggle={() => toggle(u.id)}
                      onAsk={onAsk}
                    />
                  ))}
                </ul>
                {list.length > limit && (
                  <button
                    className="btn more"
                    onClick={() => setLimit((n) => n + PAGE)}
                  >
                    Xem thêm {Math.min(PAGE, list.length - limit)} đơn vị
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
