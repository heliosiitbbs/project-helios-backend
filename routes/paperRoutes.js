import express from "express";
import {
  addPaper,
  getPapers,
  getPaperSubjects,
  getPapersForReview,
  verifyPaper,
  deletePaper
} from "../controllers/paperController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";
import uploadPaper from "../middlewares/uploadPaper.js";

const router = express.Router();

router.post("/", protect, uploadPaper.single("paper"), addPaper);
router.get("/", protect, getPapers);
router.get("/subjects", protect, getPaperSubjects);

const reviewers = authorize("ARP Admin", "Super Admin");
router.get("/admin", protect, reviewers, getPapersForReview);
router.patch("/admin/:id/verify", protect, reviewers, verifyPaper);
router.delete("/admin/:id", protect, reviewers, deletePaper);

export default router;
