import express from "express";
import { staffLogin, protectStaff, requirePasswordChanged, changeStaffPassword, getMyGrievances, addGrievanceUpdate } from "../controllers/staffController.js";

const router = express.Router();

router.post("/login", staffLogin);
router.post("/change-password", protectStaff, changeStaffPassword);
router.get("/grievances", protectStaff, requirePasswordChanged, getMyGrievances);
router.post("/grievances/:id/updates", protectStaff, requirePasswordChanged, addGrievanceUpdate);

export default router;
