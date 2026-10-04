import express from "express";
import { getNews, createNews, getAdminNews, updateNews, deleteNews } from "../controllers/newsController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/get-news", protect, getNews);
router.post("/create-news", protect, authorize("ORACLE Admin"), createNews);
router.get("/get-admin-news", protect, authorize("ORACLE Admin"), getAdminNews);
router.put("/update-news/:id", protect, authorize("ORACLE Admin"), updateNews);
router.delete("/delete-news/:id", protect, authorize("ORACLE Admin"), deleteNews);

export default router;
