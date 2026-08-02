import express from "express";
import {
    getAllWebsites,
    createWebsite,
    updateWebsite,
    deleteWebsite
} from "../controllers/websiteController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", protect, getAllWebsites);
router.post("/", protect, createWebsite);
router.put("/:id", protect, updateWebsite);
router.delete("/:id", protect, deleteWebsite);

export default router;
