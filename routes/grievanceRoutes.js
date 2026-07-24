import express from "express";
import { protect, authorize } from "../middlewares/authMiddleware.js"; // Uses your current auth protection layer
import uploadGrievanceProof from "../middlewares/uploadGrievanceProof.js";
import {
    getUnresolvedGrievances,
    uploadGrievance,
    assignGrievance,
    markResolved,
    getGrievanceHistory,
    getAllGrievances
} from "../controllers/grievanceController.js";

const router = express.Router();

// Apply your protect middleware to all grievance routes
router.use(protect);

router.get("/get-unresolved-grievances", getUnresolvedGrievances);
router.post("/upload-grievances", uploadGrievanceProof.single("proof"), uploadGrievance);
router.post("/assign-grievance", authorize('Admin'), assignGrievance);
router.post("/mark-resolved", markResolved);
router.get("/get-grievance-history", getGrievanceHistory);
router.get("/get-all-grievances", authorize('Admin'), getAllGrievances);

export default router;