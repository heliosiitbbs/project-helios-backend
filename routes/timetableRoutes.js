import express from "express";
import { 
  getMyTimetable, 
  getMyCurriculum, 
  updateMySubjectSelections,
  getAdminTimetableSlots,
  updateAdminTimetableSlots
} from "../controllers/timetableController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/my-timetable", protect, getMyTimetable);
router.get("/my-curriculum", protect, getMyCurriculum);
router.patch("/register-subjects", protect, updateMySubjectSelections);

// Admin slots routes (public to support login-less frontend)
router.get("/slots", getAdminTimetableSlots);
router.post("/slots", updateAdminTimetableSlots);

export default router;
