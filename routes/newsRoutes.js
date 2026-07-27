import express from "express";
import { getNews, createNews } from "../controllers/newsController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/get-news", protect, getNews);
router.post("/create-news", protect, createNews);

export default router;
