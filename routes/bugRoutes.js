import express from "express";
import { createBugReport, getBugReports, resolveBugReport } from "../controllers/bugController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";
import upload from "../middlewares/uploadBugScreenshot.js";

const router = express.Router();

router.post("/report", protect, upload.single("screenshot"), createBugReport);
router.get("/", protect, authorize("Admin", "Super Admin"), getBugReports);
router.patch("/:id/resolve", protect, authorize("Admin", "Super Admin"), resolveBugReport);

export default router;
