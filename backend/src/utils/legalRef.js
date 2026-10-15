function parseLegalRef(row) {
  if (row.article_no || row.clause_no) {
    return {
      dieu: row.article_no,
      khoan: row.clause_no,
      diem: row.point_no || null,
    };
  }
  const n = row.notes || "";
  return {
    dieu: n.match(/Điều\s+(\d+)/i)?.[1] || null,
    khoan: n.match(/Khoản\s+(\d+)/i)?.[1] || null,
    diem: n.match(/Điểm\s+([a-zđ])\b/i)?.[1] || null,
  };
}

function refText(row) {
  const { dieu, khoan, diem } = parseLegalRef(row);
  const loc = [
    diem && `điểm ${diem}`,
    khoan && `khoản ${khoan}`,
    dieu && `Điều ${dieu}`,
  ]
    .filter(Boolean)
    .join(" ");
  return `${loc ? loc + " " : ""}${row.doc_title || row.doc_code}`;
}

function legalSuffix(rows) {
  const refs = [...new Set(rows.filter((r) => r.doc_code).map(refText))];
  return refs.length ? `, theo ${refs.join("; ")}` : "";
}

module.exports = { parseLegalRef, refText, legalSuffix };
