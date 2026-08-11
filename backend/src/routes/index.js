const express = require("express");
const router = express.Router();

const healthController = require("../controllers/health.controller");
const provincesController = require("../controllers/provinces.controller");
const adminUnitsController = require("../controllers/adminUnits.controller");
const qaController = require("../controllers/qa.controller");
const documentsController = require("../controllers/documents.controller");
const feedbackController = require("../controllers/feedback.controller");

router.get("/health", healthController.check);

// LƯU Ý: /search phải khai báo TRƯỚC /:id (Express match theo thứ tự khai báo)
router.get("/provinces/search", provincesController.searchByOldName);
router.get("/provinces/:id", provincesController.getById);
router.get("/provinces", provincesController.list);

router.get("/admin-units/search", adminUnitsController.searchByOldName);
router.get("/admin-units/:id", adminUnitsController.getById);
router.get("/admin-units", adminUnitsController.list);

router.post("/qa/ask", qaController.ask);

router.get("/documents/:id", documentsController.getById);
router.post("/feedback", feedbackController.create);

module.exports = router;
