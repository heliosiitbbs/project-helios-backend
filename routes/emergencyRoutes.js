import express from "express";

import {
    getEmergencyContacts,
    addEmergencyContact,
    updateEmergencyContact,
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
    authorize('Admin', 'Super Admin'),
    addEmergencyContact
);

router.put(
    "/update-emergency-contact/:id",
    protect,
    authorize('Admin', 'Super Admin'),
    updateEmergencyContact
);

router.delete(
    "/remove-emergency-contact/:id",
    protect,
    authorize('Admin', 'Super Admin'),
    removeEmergencyContact
);

export default router;
