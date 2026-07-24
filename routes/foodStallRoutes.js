import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { getFoodStalls } from "../controllers/foodStallController.js";

const router = express.Router();

router.get("/get-food-stalls", protect, getFoodStalls);

export default router;
