import express from "express";
import { getNews, createNews, getAdminNews, updateNews, deleteNews } from "../controllers/newsController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/get-news", protect, getNews);
router.post("/create-news", protect, createNews);
router.get("/get-admin-news", protect, getAdminNews);
router.put("/update-news/:id", protect, updateNews);
router.delete("/delete-news/:id", protect, deleteNews);

export default router;
