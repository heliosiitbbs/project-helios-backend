import express from "express";
import {
    getFoodStalls,
    createFoodStall,
    updateFoodStall,
    deleteFoodStall,
    getFoodStallStats,
    searchFoodStalls,
    getFoodStallById
} from "../controllers/foodStallController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Specific routes (MUST come before /:id)
router.get("/stats", protect, getFoodStallStats);
router.get("/search", protect, searchFoodStalls);
router.get("/get-food-stalls", protect, getFoodStalls); // Legacy endpoint support

// Root CRUD routes
router.get("/", protect, getFoodStalls);
router.post("/", protect, createFoodStall);
router.put("/:id", protect, updateFoodStall);
router.delete("/:id", protect, deleteFoodStall);

// Parameterized route (MUST come after specific routes)
router.get("/:id", protect, getFoodStallById);

export default router;
