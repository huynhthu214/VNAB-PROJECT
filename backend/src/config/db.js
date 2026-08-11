const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

pool.on("error", (err) => {
  console.error("Lỗi kết nối PostgreSQL không mong muốn:", err);
});

module.exports = pool;
