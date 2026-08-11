require("dotenv").config();
const express = require("express");
const cors = require("cors");
const apiRouter = require("./routes/index");
const { fail } = require("./utils/response");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use("/api/v1", apiRouter);

app.use((req, res) => {
  res.status(404).json(fail("Không tìm thấy endpoint", "NOT_FOUND"));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json(fail("Lỗi hệ thống", "INTERNAL_ERROR"));
});

app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}/api/v1`);
});
