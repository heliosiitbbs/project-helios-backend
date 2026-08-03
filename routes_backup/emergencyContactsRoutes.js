import express from "express";
import {
    getAllEmergencyContacts,
    createEmergencyContact,
    updateEmergencyContact,
    deleteEmergencyContact,
    getEmergencyContactStats
} from "../controllers/emergencyContactsController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Specific routes first
router.get("/stats", protect, getEmergencyContactStats);

// Generic routes
router.get("/", protect, getAllEmergencyContacts);
router.post("/", protect, createEmergencyContact);
router.put("/:id", protect, updateEmergencyContact);
router.delete("/:id", protect, deleteEmergencyContact);

export default router;
