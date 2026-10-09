import express from "express";
import {
  runNow,
  getSchedulerStatus,
  downloadExpiredUsersArchive,
  downloadGraduatedStudentsArchive,
  downloadLostAndFoundArchive
} from "../controllers/schedulerController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Trigger scheduler jobs on demand
router.post("/run-now", protect, runNow);

// View status and logs
router.get("/status", protect, getSchedulerStatus);

// Download Excel archives
router.get("/archives/expired-users", protect, downloadExpiredUsersArchive);
router.get("/archives/graduated-students", protect, downloadGraduatedStudentsArchive);
router.get("/archives/lost-and-found", protect, downloadLostAndFoundArchive);

export default router;
