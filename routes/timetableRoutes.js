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
import {
  getTimetableBranches,
  getAdminTimings,
  addAdminTiming,
  updateAdminTiming,
  deleteAdminTiming,
  exportAdminTimings,
  previewTimetableUpload,
  applyTimetableUpload
} from "../controllers/timetableAdminController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";
import uploadSpreadsheet from "../middlewares/uploadSpreadsheet.js";

const router = express.Router();

router.get("/my-timetable", protect, getMyTimetable);
router.get("/my-curriculum", protect, getMyCurriculum);
router.patch("/register-subjects", protect, updateMySubjectSelections);

const holidayAdminRoles = authorize("Admin", "Super Admin", "Time Table Admin");
router.get("/holidays", protect, holidayAdminRoles, getAllHolidays);
router.post("/holidays", protect, holidayAdminRoles, addHoliday);
router.delete("/holidays/:id", protect, holidayAdminRoles, deleteHoliday);

// Timetable editing (Time Table Admin console)
const timetableAdminRoles = authorize("Super Admin", "Time Table Admin");
router.get("/admin/branches", protect, timetableAdminRoles, getTimetableBranches);
router.get("/admin/timings", protect, timetableAdminRoles, getAdminTimings);
router.get("/admin/timings/export", protect, timetableAdminRoles, exportAdminTimings);
router.post("/admin/timings/preview", protect, timetableAdminRoles, uploadSpreadsheet.single("file"), previewTimetableUpload);
router.post("/admin/timings/apply", protect, timetableAdminRoles, applyTimetableUpload);
router.post("/admin/timings", protect, timetableAdminRoles, addAdminTiming);
router.patch("/admin/timings/:id", protect, timetableAdminRoles, updateAdminTiming);
router.delete("/admin/timings/:id", protect, timetableAdminRoles, deleteAdminTiming);
// Admin slots routes (public to support login-less frontend)
router.get("/slots", getAdminTimetableSlots);
router.post("/slots", updateAdminTimetableSlots);
export default router;
