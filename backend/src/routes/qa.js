const express = require("express");
const router = express.Router();
const { ask } = require("../controllers/qa.controller.js");

router.post("/ask", ask);
module.exports = router;
