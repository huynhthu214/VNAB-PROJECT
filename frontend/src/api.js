import { useEffect, useState } from "react";
import {
  PROVINCES,
  FALLBACK_DOCS,
  mockToUnits,
  unitKind,
  provinceByCode,
} from "./data.js";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/v1";

/* =========================================================
   DỮ LIỆU CHO CÁC TAB TRA CỨU / KHÁM PHÁ / PHÁP LÝ
   Chat vẫn gọi POST /qa/ask như cũ (xem ChatTab.jsx).

   Mặc định dùng dữ liệu mẫu trong data.js. Khi backend có 2 endpoint dưới
   đây, đặt VITE_LOOKUP_API=true trong .env để giao diện đọc dữ liệu thật:

   GET {API}/units?province_code=HCM
     → { success: true, data: { units: [
         { new_unit_name, new_unit_type,
           old_units: [{ name, type, parent_name, merge_type }],   // merge_type: toan_bo | mot_phan
           headquarters_address, decision_number, decision_date, source_url }
       ] } }

   GET {API}/legal-documents
     → { success: true, data: [{ doc_code, title, issue_date, source_url }] }
   ========================================================= */
const LOOKUP_API = import.meta.env.VITE_LOOKUP_API === "true";

function normalizeApiUnit(u, provinceCode, i) {
  const newName = u.new_unit_name || u.new_name || "";
  return {
    id: `${provinceCode}_${i}`,
    province: provinceCode,
    newName,
    newType: u.new_unit_type || unitKind(newName),
    oldUnits: (u.old_units || []).map((o) => ({
      name: o.name || o.old_unit_name || "",
      type: o.type || unitKind(o.name || ""),
      parent: o.parent_name || o.old_parent || "",
      merge: o.merge_type === "mot_phan" ? "mot_phan" : "toan_bo",
    })),
    hq: u.headquarters_address || "",
    decisionNumber: u.decision_number || "",
    decisionDate: u.decision_date || "",
    sourceUrl: /^https?:\/\//.test(u.source_url || "") ? u.source_url : "",
    sample: false,
  };
}

async function getJson(path) {
  const r = await fetch(`${API_BASE_URL}${path}`);
  const body = await r.json();
  if (!body || body.success !== true) throw new Error("bad response");
  return body.data;
}

async function loadDirectory() {
  const sample = mockToUnits();
  if (!LOOKUP_API) {
    return { units: sample, docs: FALLBACK_DOCS, live: false };
  }
  let units = [];
  let docs = FALLBACK_DOCS;
  const results = await Promise.allSettled(
    PROVINCES.filter((p) => p.apiCode).map(async (p) => {
      const data = await getJson(
        `/units?province_code=${encodeURIComponent(p.apiCode)}`,
      );
      return (data.units || []).map((u, i) => normalizeApiUnit(u, p.code, i));
    }),
  );
  const loaded = new Set();
  results.forEach((r, idx) => {
    if (r.status === "fulfilled" && r.value.length) {
      units = units.concat(r.value);
      loaded.add(PROVINCES.filter((p) => p.apiCode)[idx].code);
    }
  });
  // tỉnh nào API chưa trả được thì giữ dữ liệu mẫu của tỉnh đó
  units = units.concat(sample.filter((u) => !loaded.has(u.province)));
  try {
    const d = await getJson("/legal-documents");
    if (Array.isArray(d) && d.length) {
      docs = d.map((x) => ({
        code: x.doc_code,
        title: x.title,
        date: x.issue_date,
        url: /^https?:\/\//.test(x.source_url || "") ? x.source_url : "",
        scope: "",
      }));
    }
  } catch {
    /* giữ danh sách mặc định */
  }
  return { units, docs, live: loaded.size > 0 };
}

/* Hook dùng một lần ở App, truyền xuống các tab */
export function useDirectory() {
  const [state, setState] = useState({
    units: [],
    docs: FALLBACK_DOCS,
    live: false,
    loading: true,
  });
  useEffect(() => {
    let cancelled = false;
    loadDirectory()
      .then((d) => {
        if (!cancelled) setState({ ...d, loading: false });
      })
      .catch(() => {
        if (!cancelled)
          setState({
            units: mockToUnits(),
            docs: FALLBACK_DOCS,
            live: false,
            loading: false,
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/* Số liệu tổng hợp cho trang Tổng quan */
export function buildStats(units, docs) {
  const perProvince = {};
  for (const p of PROVINCES) {
    perProvince[p.code] = { newUnits: 0, oldUnits: 0, partial: 0 };
  }
  for (const u of units) {
    const s = perProvince[u.province];
    if (!s) continue;
    s.newUnits += 1;
    s.oldUnits += u.oldUnits.length;
    s.partial += u.oldUnits.some((o) => o.merge === "mot_phan") ? 1 : 0;
  }
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
  return {
    provinces: PROVINCES.length,
    oldProvinces,
    oldUnits: total.oldUnits,
    newUnits: total.newUnits,
    docs: docs.length,
    perProvince,
  };
}

export { provinceByCode };
