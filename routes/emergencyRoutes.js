import express from "express";

import {
    getEmergencyContacts,
    editEmergencyContact
} from "../controllers/emergencyController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get(
    "/get-emergency-contacts",
    protect,
    getEmergencyContacts
);

router.put(
    "/edit-emergency-contact",
    protect,
    authorize('Admin'),
    editEmergencyContact
);

export default router;