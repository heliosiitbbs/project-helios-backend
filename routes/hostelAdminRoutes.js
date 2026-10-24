import express from "express";
import { protect, authorize } from "../middlewares/authMiddleware.js";
import {
    requireHostel,
    getHostelGrievances,
    assignHostelGrievance,
    getHostelStaff,
    addHostelStaff,
    updateHostelStaff,
    setStaffPin,
    deleteHostelStaff,
    getHostelMenu,
    saveHostelMenu
} from "../controllers/hostelAdminController.js";

const router = express.Router();

router.use(protect, authorize("Hostel Admin"), requireHostel);

router.get("/grievances", getHostelGrievances);
router.post("/grievances/:id/assign", assignHostelGrievance);

router.get("/staff", getHostelStaff);
router.post("/staff", addHostelStaff);
router.patch("/staff/:id", updateHostelStaff);
router.post("/staff/:id/pin", setStaffPin);
router.delete("/staff/:id", deleteHostelStaff);

router.get("/menu", getHostelMenu);
router.put("/menu", saveHostelMenu);

export default router;
