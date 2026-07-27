import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import uploadLeaveProof from "../middlewares/uploadLeaveProof.js";
import { applyForLeave, getMyLeaveApplications } from "../controllers/leaveController.js";

const router = express.Router();

router.post("/apply", protect, uploadLeaveProof.single("proof"), applyForLeave);
router.get("/my-applications", protect, getMyLeaveApplications);

export default router;
