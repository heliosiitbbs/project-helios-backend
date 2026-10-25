import express from "express";
import {
  getMyTimetable,
  getMyCurriculum,
  updateMySubjectSelections,
  searchSubjectsForStudent,
  addExtraSubject,
  removeExtraSubject,
  getAllHolidays,
  addHoliday,
  deleteHoliday
} from "../controllers/timetableController.js";
import {
  getTimetableBranches,
  getAdminCurriculum,
  saveAdminCurriculum,
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
// Backlogs and other subjects outside the curriculum
router.get("/subject-search", protect, searchSubjectsForStudent);
router.post("/extra-subjects", protect, addExtraSubject);
router.delete("/extra-subjects/:code", protect, removeExtraSubject);

const holidayAdminRoles = authorize("Admin", "Super Admin", "Time Table Admin");
router.get("/holidays", protect, holidayAdminRoles, getAllHolidays);
router.post("/holidays", protect, holidayAdminRoles, addHoliday);
router.delete("/holidays/:id", protect, holidayAdminRoles, deleteHoliday);

// Timetable editing (Time Table Admin console)
const timetableAdminRoles = authorize("Super Admin", "Time Table Admin");
router.get("/admin/branches", protect, authorize("Super Admin", "Time Table Admin", "ARP Admin"), getTimetableBranches);
// ARP Admin reads the curriculum for the paper coverage grid; only Super Admin edits it
router.get("/admin/curriculum", protect, authorize("Super Admin", "ARP Admin"), getAdminCurriculum);
router.put("/admin/curriculum", protect, authorize("Super Admin"), saveAdminCurriculum);
router.get("/admin/timings", protect, timetableAdminRoles, getAdminTimings);
router.get("/admin/timings/export", protect, timetableAdminRoles, exportAdminTimings);
router.post("/admin/timings/preview", protect, timetableAdminRoles, uploadSpreadsheet.single("file"), previewTimetableUpload);
router.post("/admin/timings/apply", protect, timetableAdminRoles, applyTimetableUpload);
router.post("/admin/timings", protect, timetableAdminRoles, addAdminTiming);
router.patch("/admin/timings/:id", protect, timetableAdminRoles, updateAdminTiming);
router.delete("/admin/timings/:id", protect, timetableAdminRoles, deleteAdminTiming);
export default router;
