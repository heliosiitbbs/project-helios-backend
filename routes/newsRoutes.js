import express from "express";
import { getNews, createNews, getAdminNews, updateNews, deleteNews, uploadNewsPhoto } from "../controllers/newsController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";
import uploadNewsImage from "../middlewares/uploadNewsPhoto.js";

const router = express.Router();

router.get("/get-news", protect, getNews);
router.post("/upload-photo", protect, authorize("ORACLE Admin"), uploadNewsImage.single("photo"), uploadNewsPhoto);
router.post("/create-news", protect, authorize("ORACLE Admin"), createNews);
router.get("/get-admin-news", protect, authorize("ORACLE Admin"), getAdminNews);
router.put("/update-news/:id", protect, authorize("ORACLE Admin"), updateNews);
router.delete("/delete-news/:id", protect, authorize("ORACLE Admin"), deleteNews);

export default router;
