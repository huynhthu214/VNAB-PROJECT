const pool = require("../config/db");
const { success, fail } = require("../utils/response");

// POST /feedback
async function create(req, res) {
  try {
    const { qa_log_id, is_helpful, note } = req.body;

    if (!qa_log_id || typeof is_helpful !== "boolean") {
      return res
        .status(400)
        .json(
          fail(
            "Thiếu qa_log_id hoặc is_helpful không hợp lệ",
            "VALIDATION_ERROR",
          ),
        );
    }

    const { rowCount } = await pool.query(
      `UPDATE qa_logs SET is_helpful = $1, feedback_note = $2 WHERE id = $3`,
      [is_helpful, note || null, qa_log_id],
    );

    if (rowCount === 0) {
      return res
        .status(404)
        .json(fail("Không tìm thấy qa_log_id tương ứng", "VALIDATION_ERROR"));
    }

    return res.status(200).json(success({ recorded: true }));
  } catch (err) {
    console.error(err);
    return res.status(500).json(fail("Lỗi hệ thống", "INTERNAL_ERROR"));
  }
}

module.exports = { create };
