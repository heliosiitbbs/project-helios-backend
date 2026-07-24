import express from "express";
import {
    uploadEventData,
    approveVerifier,
    approveApplicant,
    getAllApplicantStatus,
    getMyEventPasses
} from "../controllers/eventController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Define Verification Endpoints
router.post("/upload-data", protect, authorize('Admin'), uploadEventData);
// approve-verifier is gated by the event's own verification_code, not a role -
// any authenticated user holding the code can act as door staff
router.post("/approve-verifier", protect, approveVerifier);
router.post("/approve-applicant", protect, authorize('Admin'), approveApplicant);
router.get("/get-all-applicant-status", protect, authorize('Admin'), getAllApplicantStatus);
router.get("/my-passes", protect, getMyEventPasses);

export default router;