require("dotenv").config();
const pool = require("../src/config/db"); // chỉnh đường dẫn: xem dòng require pool ở đầu qa.controller.js

function stripVN(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

(async () => {
  for (const table of ["admin_units_old", "admin_units_new"]) {
    const { rows } = await pool.query(`SELECT id, name FROM ${table}`);
    for (const r of rows) {
      await pool.query(`UPDATE ${table} SET name_norm = $1 WHERE id = $2`, [
        stripVN(r.name),
        r.id,
      ]);
    }
    console.log(table, "đã điền", rows.length, "dòng");
  }
  await pool.end();
})();
