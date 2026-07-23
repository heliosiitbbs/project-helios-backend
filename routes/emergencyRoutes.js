import express from "express";

import {
    getEmergencyContacts,
    editEmergencyContact
} from "../controllers/emergencyController.js";

const router = express.Router();

router.get(
    "/get-emergency-contacts",
    getEmergencyContacts
);

router.put(
    "/edit-emergency-contact",
    editEmergencyContact
);

export default router;