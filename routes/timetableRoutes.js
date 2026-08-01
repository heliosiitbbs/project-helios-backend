import express from "express";
import { getMyTimetable } from "../controllers/timetableController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/my-timetable", protect, getMyTimetable);

export default router;
