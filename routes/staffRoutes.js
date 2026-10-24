import express from "express";
import { staffLogin, protectStaff, getMyGrievances, addGrievanceUpdate } from "../controllers/staffController.js";

const router = express.Router();

router.post("/login", staffLogin);
router.get("/grievances", protectStaff, getMyGrievances);
router.post("/grievances/:id/updates", protectStaff, addGrievanceUpdate);

export default router;
