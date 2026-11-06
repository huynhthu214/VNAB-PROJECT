import { useDeferredValue, useMemo, useRef } from "react";
import { PROVINCES, provinceByCode, fold, formatDate } from "../data.js";
import {
  Icon,
  LineageFlow,
  LegalLink,
  SampleNotice,
} from "./shared.jsx";

const STOP = new Set(["cu", "moi"]);
const MAX_RESULTS = 40;

function tokenMatch(field, tok) {
  if (/^\d+$/.test(tok)) return new RegExp(`(^|\\D)${tok}(\\D|$)`).test(field);
  return field.includes(tok);
}

function allMatch(field, toks) {
  return toks.every((t) => tokenMatch(field, t));
}

/* Tìm theo tên đơn vị cũ, đơn vị mới hoặc quận/huyện cũ — không phân biệt dấu */
export function searchUnits(units, query, scope) {
  const q = fold(query).replace(/[?.,;:!]/g, " ").trim();
  const toks = q.split(/\s+/).filter((t) => t && !STOP.has(t));
  if (!toks.length) return [];
  const joined = toks.join(" ");
  const out = [];
  for (const u of units) {
    if (scope && u.province !== scope) continue;
    let score = 0;
    let newHit = false;
    const hits = new Set();

    const fn = fold(u.newName);
    if (allMatch(fn, toks)) {
      newHit = true;
      score = Math.max(score, fn === joined ? 100 : fn.startsWith(joined) ? 80 : 60);
    }
    u.oldUnits.forEach((o, i) => {
      const f = fold(o.name);
      if (allMatch(f, toks)) {
        hits.add(i);
        score = Math.max(score, f === joined ? 100 : f.startsWith(joined) ? 80 : 60);
      } else if (allMatch(`${f} ${fold(o.parent)}`, toks)) {
        hits.add(i);
        score = Math.max(score, 40);
      }
    });
    if (score) out.push({ unit: u, score, hits, newHit });
  }
  out.sort(
    (a, b) =>
      b.score - a.score || a.unit.newName.localeCompare(b.unit.newName, "vi"),
  );
  return out;
}

function ResultCard({ r, query, onAsk }) {
  const { unit, hits, newHit } = r;
  const p = provinceByCode(unit.province);
  const firstOld = hits.size ? unit.oldUnits[[...hits][0]] : null;
  const ask = firstOld
    ? `${firstOld.name} cũ bây giờ thuộc đơn vị nào?`
    : `${unit.newName} được hình thành từ những đơn vị nào?`;
  return (
    <article className="rcard" style={{ "--c": p?.color }}>
      <header className="rcard-head">
        <span className="ptag">
          <span className="ptag-dot" />
          {p?.name}
        </span>
        {newHit && !hits.size && <span className="tag-soft">Đơn vị mới</span>}
        {hits.size > 0 && <span className="tag-soft">Đơn vị cũ</span>}
      </header>

      <LineageFlow unit={unit} query={query} hits={hits} />

      <footer className="rcard-foot">
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
        <button className="link-btn" onClick={() => onAsk(p?.code, ask)}>
          Hỏi thêm <Icon name="arrow" size={15} />
        </button>
      </footer>
    </article>
  );
}

export default function LookupTab({
  units,
  loading,
  province,
  all,
  onScope,
  query,
  onQuery,
  onAsk,
}) {
  const inputRef = useRef(null);
  const deferred = useDeferredValue(query);
  const scope = all ? null : province;

  const results = useMemo(
    () => searchUnits(units, deferred, scope),
    [units, deferred, scope],
  );
  const shown = results.slice(0, MAX_RESULTS);
  const hasQuery = query.trim().length > 0;

  const suggestions = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const u of units) {
      if (scope && u.province !== scope) continue;
      const n = u.oldUnits[0]?.name;
      if (n && !seen.has(n)) {
        seen.add(n);
        list.push(n);
      }
      if (list.length >= 6) break;
    }
    return list;
  }, [units, scope]);

  const sampleNames = useMemo(() => {
    const codes = new Set(
      units.filter((u) => u.sample && (!scope || u.province === scope)).map((u) => u.province),
    );
    return PROVINCES.filter((p) => codes.has(p.code)).map((p) => p.name);
  }, [units, scope]);

  return (
    <div className="page lk">
      <div className="wrap narrow">
        <header className="page-head">
          <h1>Tra cứu nhanh</h1>
          <p>
            Nhập tên phường, xã (cũ hoặc mới) để xem đơn vị đó đã được chuyển
            đổi như thế nào.
          </p>
        </header>

        <div className="search-panel">
          <div className="search-box">
            <Icon name="search" size={20} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Ví dụ: Bến Nghé, Phường 5, Linh Tây..."
              aria-label="Tên phường, xã cần tra cứu"
              autoComplete="off"
              spellCheck={false}
            />
            {hasQuery && (
              <button
                className="icon-btn"
                aria-label="Xóa nội dung tìm kiếm"
                onClick={() => {
                  onQuery("");
                  inputRef.current?.focus();
                }}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
          <label className="select-pill">
            <span>Tỉnh/thành</span>
            <select
              value={all ? "all" : province}
              onChange={(e) => onScope(e.target.value)}
              aria-label="Phạm vi tra cứu"
            >
              <option value="all">Tất cả</option>
              {PROVINCES.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
            <Icon name="chevron" size={16} />
          </label>
        </div>

        <SampleNotice names={sampleNames} />

        {loading ? (
          <div className="skeleton-list" aria-hidden="true">
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : !hasQuery ? (
          <div className="lk-empty">
            <div className="lk-empty-art" aria-hidden="true">
              <Icon name="search" size={28} />
            </div>
            <h2>Bạn muốn tra cứu đơn vị nào?</h2>
            <p>Gõ tên phường, xã hoặc thử một gợi ý bên dưới.</p>
            <div className="sugg-chips">
              {suggestions.map((s) => (
                <button key={s} onClick={() => onQuery(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : shown.length === 0 ? (
          <div className="lk-empty">
            <div className="lk-empty-art warn" aria-hidden="true">
              <Icon name="alert" size={28} />
            </div>
            <h2>Không tìm thấy “{query.trim()}”</h2>
            <p>
              Thử bỏ bớt từ khóa, kiểm tra chính tả, hoặc chọn phạm vi “Tất
              cả”. Bạn cũng có thể đặt câu hỏi cho trợ lý.
            </p>
            <div className="empty-actions">
              {!all && (
                <button className="btn" onClick={() => onScope("all")}>
                  Tìm trong tất cả tỉnh
                </button>
              )}
              <button
                className="btn primary"
                onClick={() => onAsk(province, query.trim())}
              >
                <Icon name="chat" size={16} />
                Hỏi trợ lý
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="result-count" aria-live="polite">
              {results.length} kết quả cho <strong>“{query.trim()}”</strong>
              {results.length > MAX_RESULTS &&
                ` · hiển thị ${MAX_RESULTS} kết quả đầu, hãy nhập cụ thể hơn`}
            </p>
            <div className="rlist">
              {shown.map((r) => (
                <ResultCard
                  key={r.unit.id}
                  r={r}
                  query={deferred}
                  onAsk={onAsk}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
