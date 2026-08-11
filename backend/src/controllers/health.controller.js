const pool = require("../config/db");

const { success, fail } = require("../utils/response");

async function check(req, res) {
  try {
    await pool.query("SELECT 1");
    return res.status(200).json(success({ status: "ok", db: "connected" }));
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json(fail("Không kết nối được database", "INTERNAL_ERROR"));
  }
}

module.exports = { check };
