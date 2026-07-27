import express from "express";

import {
    getEmergencyContacts,
    addEmergencyContact,
    removeEmergencyContact
} from "../controllers/emergencyController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get(
    "/get-emergency-contacts",
    protect,
    getEmergencyContacts
);

router.post(
    "/add-emergency-contact",
    protect,
    authorize('Admin'),
    addEmergencyContact
);

router.delete(
    "/remove-emergency-contact/:id",
    protect,
    authorize('Admin'),
    removeEmergencyContact
);

export default router;
