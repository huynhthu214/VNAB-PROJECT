const pool = require("../config/db");
const { success, fail } = require("../utils/response");

// GET /documents/:id
async function getById(req, res) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT doc_code AS id, title, issuing_body, issue_date, source_url,
              (full_text IS NOT NULL AND full_text != '') AS full_text_available
       FROM legal_documents
       WHERE doc_code = $1`,
      [id],
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json(
          fail("Không tìm thấy văn bản/nguồn trích dẫn", "DOCUMENT_NOT_FOUND"),
        );
    }
    return res.status(200).json(success(rows[0]));
  } catch (err) {
    console.error(err);
    return res.status(500).json(fail("Lỗi hệ thống", "INTERNAL_ERROR"));
  }
}

module.exports = { getById };
