const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  keepAlive: true,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
  console.error("Lỗi kết nối PostgreSQL không mong muốn:", err);
});

module.exports = pool;
