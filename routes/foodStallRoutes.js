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
import { protect, authorize } from "../middlewares/authMiddleware.js";
import upload from "../middlewares/uploadStallPhoto.js";

const router = express.Router();

// Specific routes (MUST come before /:id)
router.get("/stats", protect, getFoodStallStats);
router.get("/search", protect, searchFoodStalls);
router.get("/get-food-stalls", protect, getFoodStalls); // Legacy endpoint support

// Root CRUD routes
router.get("/", protect, getFoodStalls);
router.post("/", protect, authorize("Super Admin", "Admin"), upload.single("photo"), createFoodStall);
router.put("/:id", protect, authorize("Super Admin", "Admin"), upload.single("photo"), updateFoodStall);
router.delete("/:id", protect, authorize("Super Admin", "Admin"), deleteFoodStall);

// Parameterized route (MUST come after specific routes)
router.get("/:id", protect, getFoodStallById);

export default router;
