import express from "express";
import { getEmergencyContacts } from "../controllers/emergencyController.js";

const router = express.Router();

// =====================================
// GET EMERGENCY CONTACTS
// =====================================
router.get(
    "/get-emergency-contacts",
    getEmergencyContacts
);

export default router;