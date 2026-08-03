import express from "express";
import {
    getAllResources,
    createResource,
    updateResource,
    deleteResource,
    getResourceStats,
    searchResources,
    getResourcesByType,
    getResourceById
} from "../controllers/vaultResourcesController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Specific named routes (MUST come before /:resource_id)
router.get("/stats", protect, getResourceStats);
router.get("/search", protect, searchResources);
router.get("/type/:resource_type", protect, getResourcesByType);

// Root CRUD routes
router.get("/", protect, getAllResources);
router.post("/", protect, createResource);
router.put("/:resource_id", protect, updateResource);
router.delete("/:resource_id", protect, deleteResource);

// Parameterized route (MUST come after specific routes)
router.get("/:resource_id", protect, getResourceById);

export default router;
