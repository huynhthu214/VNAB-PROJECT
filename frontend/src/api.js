import { useCallback, useEffect, useState } from "react";
import {
  PROVINCES,
  NATIONAL_BASIS,
  FALLBACK_DOCS,
  mockToUnits,
  unitKind,
  provinceByCode,
  fold,
} from "./data.js";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/v1";

/* =========================================================
   DỮ LIỆU CHO CÁC TAB TRA CỨU / KHÁM PHÁ / PHÁP LÝ
   Chat vẫn gọi POST /qa/ask như cũ (xem ChatTab.jsx).

   Mặc định đọc dữ liệu thật từ backend. Chỉ khi đặt VITE_LOOKUP_API=false
   (dùng khi phát triển giao diện không có backend) mới dùng dữ liệu mẫu.
   Khi backend lỗi, giao diện báo lỗi kèm nút thử lại, KHÔNG tự chèn dữ liệu mẫu.

   GET {API}/units?province_code=HCM
     → { success: true, data: { units: [
         { new_unit_name, new_unit_type,
           old_units: [{ id, name, type, parent_name, province_old, merge_type }],
           headquarters_address, decision_number, decision_date, source_url }
       ] } }

   GET {API}/legal-documents
     → { success: true, data: [{ doc_code, title, issue_date, source_url }] }
   ========================================================= */
const LOOKUP_API = import.meta.env.VITE_LOOKUP_API !== "false";

// DB lưu loại đơn vị dạng mã (phuong, xa, thi_tran...) -> nhãn hiển thị
const KIND = {
  phuong: "Phường",
  xa: "Xã",
  thi_tran: "Thị trấn",
  dac_khu: "Đặc khu",
  huyen: "Huyện",
  quan: "Quận",
  thi_xa: "Thị xã",
  thanh_pho: "Thành phố",
};
function kindLabel(type, name) {
  return (
    KIND[String(type || "").toLowerCase()] ||
    (/^[A-ZÀ-Ỹ]/.test(type || "") ? type : unitKind(name))
  );
}

function normalizeApiUnit(u, provinceCode, i) {
  const newName = u.new_unit_name || u.new_name || "";
  return {
    id: `${provinceCode}_${i}`,
    province: provinceCode,
    newName,
    newType: kindLabel(u.new_unit_type, newName),
    oldUnits: (u.old_units || []).map((o) => {
      const name = o.name || o.old_unit_name || "";
      const parent = o.parent_name || o.old_parent || "";
      return {
        // khóa nhận diện đơn vị cũ: một đơn vị cũ bị chia vẫn chỉ tính 1 lần
        key: o.id != null ? `id:${o.id}` : `${fold(name)}|${fold(parent)}`,
        name,
        type: kindLabel(o.type, name),
        parent,
        provinceOld: o.province_old || "",
        merge: o.merge_type === "mot_phan" ? "mot_phan" : "toan_bo",
      };
    }),
    hq: u.headquarters_address || "",
    decisionNumber: u.decision_number || "",
    decisionDate: u.decision_date || "",
    sourceUrl: /^https?:\/\//.test(u.source_url || "") ? u.source_url : "",
    sample: false,
  };
}

// Văn bản pháp lý thật có số hiệu dạng 1663/NQ-UBTVQH15 hoặc 202/2025/QH15.
// Loại các bản ghi tổng hợp tự động (dùng nội bộ cho RAG) nếu backend lỡ trả về.
function isRealDoc(d) {
  const code = String(d?.doc_code || "").trim();
  return (
    /^\d+\/(\d{4}\/)?[A-ZĐ]/.test(code) &&
    !/tổng hợp tự động/i.test(d?.title || "")
  );
}

// "…cấp xã của tỉnh Đồng Tháp năm 2025" → "tỉnh Đồng Tháp"
function docScope(title) {
  const m = String(title || "").match(
    /(?:của|tại)\s+((?:tỉnh|thành phố|TP\.?)\s+[^,;()]+?)(?:\s+năm\s+\d{4})?\s*$/i,
  );
  return m ? m[1].trim() : "";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(path) {
  const r = await fetch(`${API_BASE_URL}${path}`);
  const body = await r.json();
  if (!body || body.success !== true) throw new Error("bad response");
  return body.data;
}

async function getJsonRetry(path, tries = 2) {
  try {
    return await getJson(path);
  } catch (e) {
    if (tries <= 1) throw e;
    await sleep(700);
    return getJsonRetry(path, tries - 1);
  }
}

/* Căn cứ pháp lý chính của từng tỉnh: văn bản được dẫn nhiều nhất trong dữ liệu */
export function buildBasis(units) {
  const tally = {};
  for (const u of units) {
    if (!u.decisionNumber || u.sample) continue;
    const t = (tally[u.province] ||= {});
    const e = (t[u.decisionNumber] ||= {
      code: u.decisionNumber,
      url: "",
      date: "",
      n: 0,
    });
    e.n += 1;
    if (!e.url && u.sourceUrl) e.url = u.sourceUrl;
    if (!e.date && u.decisionDate) e.date = u.decisionDate;
  }
  const out = {};
  for (const [prov, t] of Object.entries(tally)) {
    out[prov] = Object.values(t).sort((a, b) => b.n - a.n)[0];
  }
  return out;
}

async function loadDirectory() {
  if (!LOOKUP_API) {
    const sample = mockToUnits();
    return {
      units: sample,
      docs: FALLBACK_DOCS,
      live: false,
      failed: [],
      basis: buildBasis(sample),
    };
  }

  const list = PROVINCES.filter((p) => p.apiCode);
  const results = await Promise.allSettled(
    list.map(async (p) => {
      const data = await getJsonRetry(
        `/units?province_code=${encodeURIComponent(p.apiCode)}`,
      );
      return (data.units || []).map((u, i) => normalizeApiUnit(u, p.code, i));
    }),
  );
  let units = [];
  const failed = [];
  results.forEach((r, idx) => {
    if (r.status === "fulfilled" && r.value.length) {
      units = units.concat(r.value);
    } else {
      failed.push(list[idx].code);
    }
  });

  let docs = [];
  try {
    const d = await getJsonRetry("/legal-documents");
    if (Array.isArray(d)) {
      docs = d.filter(isRealDoc).map((x) => ({
        code: x.doc_code,
        title: x.title,
        date: x.issue_date,
        url: /^https?:\/\//.test(x.source_url || "") ? x.source_url : "",
        scope: docScope(x.title),
      }));
    }
  } catch {
    /* không đọc được danh sách văn bản: để trống, không dùng dữ liệu mẫu */
  }
  return {
    units,
    docs,
    live: units.length > 0,
    failed,
    basis: buildBasis(units),
  };
}

/* Hook dùng một lần ở App, truyền xuống các tab */
export function useDirectory() {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState({
    units: [],
    docs: [],
    live: false,
    failed: [],
    basis: {},
    loading: true,
  });
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    setTick((n) => n + 1);
  }, []);
  useEffect(() => {
    let cancelled = false;
    loadDirectory()
      .then((d) => {
        if (!cancelled) setState({ ...d, loading: false });
      })
      .catch(() => {
        if (!cancelled)
          setState({
            units: [],
            docs: [],
            live: false,
            failed: PROVINCES.map((p) => p.code),
            basis: {},
            loading: false,
          });
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);
  return { ...state, reload };
}

/* Số liệu tổng hợp cho trang Tổng quan.
   Đơn vị cũ đếm theo đơn vị riêng biệt: đơn vị cũ bị chia cho nhiều đơn vị
   mới (nhãn "Một phần") chỉ tính một lần. */
export function buildStats(units, docs) {
  const perProvince = {};
  const oldSeen = {};
  for (const p of PROVINCES) {
    perProvince[p.code] = { newUnits: 0, oldUnits: 0, partial: 0 };
    oldSeen[p.code] = new Set();
  }
  for (const u of units) {
    const s = perProvince[u.province];
    if (!s) continue;
    s.newUnits += 1;
    for (const o of u.oldUnits) oldSeen[u.province].add(o.key || o.name);
    s.partial += u.oldUnits.some((o) => o.merge === "mot_phan") ? 1 : 0;
  }
  for (const p of PROVINCES)
    perProvince[p.code].oldUnits = oldSeen[p.code].size;

  const oldProvinces = PROVINCES.reduce(
    (n, p) => n + p.merged.split(",").length,
    0,
  );
  const total = Object.values(perProvince).reduce(
    (a, s) => ({
      newUnits: a.newUnits + s.newUnits,
      oldUnits: a.oldUnits + s.oldUnits,
    }),
    { newUnits: 0, oldUnits: 0 },
  );
  // văn bản căn cứ: nghị quyết cả nước + các nghị quyết đã nạp, không đếm trùng
  const docCodes = new Set([NATIONAL_BASIS.code, ...docs.map((d) => d.code)]);
  return {
    provinces: PROVINCES.length,
    oldProvinces,
    oldUnits: total.oldUnits,
    newUnits: total.newUnits,
    docs: docCodes.size,
    perProvince,
  };
}

export { provinceByCode };
