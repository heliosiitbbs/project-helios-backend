import express from "express";
import { protect, authorize } from "../middlewares/authMiddleware.js";
import { getStudentEntries, getGuestEntries, getVehicleNumbers } from "../controllers/gateController.js";

const router = express.Router();

const canView = authorize("Admin", "Super Admin", "Security Guard");

router.get("/students", protect, canView, getStudentEntries);
router.get("/guests", protect, canView, getGuestEntries);
router.get("/vehicle-numbers", protect, canView, getVehicleNumbers);

export default router;
