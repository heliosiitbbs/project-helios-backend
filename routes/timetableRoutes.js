import express from "express";
import {
  getMyTimetable,
  getMyCurriculum,
  updateMySubjectSelections,
  getAllHolidays,
  addHoliday,
  deleteHoliday,
  getAdminTimetableSlots,
  updateAdminTimetableSlots
} from "../controllers/timetableController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/my-timetable", protect, getMyTimetable);
router.get("/my-curriculum", protect, getMyCurriculum);
router.patch("/register-subjects", protect, updateMySubjectSelections);

const holidayAdminRoles = authorize("Admin", "Super Admin", "Time Table Admin");
router.get("/holidays", protect, holidayAdminRoles, getAllHolidays);
router.post("/holidays", protect, holidayAdminRoles, addHoliday);
router.delete("/holidays/:id", protect, holidayAdminRoles, deleteHoliday);
// Admin slots routes (public to support login-less frontend)
router.get("/slots", getAdminTimetableSlots);
router.post("/slots", updateAdminTimetableSlots);
export default router;
