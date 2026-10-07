import express from "express";
import {
    uploadEventData,
    approveVerifier,
    approveApplicant,
    getAllApplicantStatus,
    getMyEventPasses,
    scanPass,
    listEvents,
    createEventWithPasses,
    getEventPasses,
    addEventPasses,
    revokePass,
    parseApplicantsFile
} from "../controllers/eventController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";
import uploadSpreadsheet from "../middlewares/uploadSpreadsheet.js";

const router = express.Router();

// Define Verification Endpoints
router.post("/upload-data", protect, authorize('Admin', 'Super Admin'), uploadEventData);
// approve-verifier is gated by the event's own verification_code, not a role -
// any authenticated user holding the code can act as door staff
router.post("/approve-verifier", protect, approveVerifier);
router.post("/approve-applicant", protect, authorize('Admin', 'Super Admin'), approveApplicant);
router.get("/get-all-applicant-status", protect, authorize('Admin', 'Super Admin'), getAllApplicantStatus);
router.get("/my-passes", protect, getMyEventPasses);
// Door staff scanning a pass QR - gated by the event verification code, like approve-verifier
router.post("/scan-pass", protect, scanPass);

// Admin dashboard: events & issuing passes
const eventAdmins = authorize("Admin", "Super Admin");
router.get("/", protect, eventAdmins, listEvents);
router.post("/create", protect, eventAdmins, createEventWithPasses);
router.post("/parse-applicants", protect, eventAdmins, uploadSpreadsheet.single("file"), parseApplicantsFile);
router.delete("/passes/:passId", protect, eventAdmins, revokePass);
router.get("/:eventId/passes", protect, eventAdmins, getEventPasses);
router.post("/:eventId/passes", protect, eventAdmins, addEventPasses);

export default router;