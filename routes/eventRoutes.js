import express from "express";
import { 
    uploadEventData, 
    approveVerifier, 
    approveApplicant, 
    getAllApplicantStatus 
} from "../controllers/eventController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Define Verification Endpoints
router.post("/upload-data", protect, uploadEventData);
router.post("/approve-verifier", protect, approveVerifier);
router.post("/approve-applicant", protect, approveApplicant);
router.get("/get-all-applicant-status", protect, getAllApplicantStatus);

export default router;