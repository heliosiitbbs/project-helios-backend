import express from "express";
<<<<<<< HEAD
import { getEmergencyContacts } from "../controllers/emergencyController.js";

const router = express.Router();

// =====================================
// GET EMERGENCY CONTACTS
// =====================================
=======

import {
    getEmergencyContacts,
    editEmergencyContact
} from "../controllers/emergencyController.js";

const router = express.Router();

>>>>>>> origin/trilok-featues
router.get(
    "/get-emergency-contacts",
    getEmergencyContacts
);

<<<<<<< HEAD
=======
router.put(
    "/edit-emergency-contact",
    editEmergencyContact
);

>>>>>>> origin/trilok-featues
export default router;