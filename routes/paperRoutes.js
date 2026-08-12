import express from "express";
import { addPaper, getPapers } from "../controllers/paperController.js";
import { protect } from "../middlewares/authMiddleware.js";
import uploadPaper from "../middlewares/uploadPaper.js";

const router = express.Router();

router.post("/", protect, uploadPaper.single("paper"), addPaper);
router.get("/", protect, getPapers);

export default router;
