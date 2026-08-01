import express from "express";
import { getMyTimetable, getMyCurriculum, updateMySubjectSelections } from "../controllers/timetableController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/my-timetable", protect, getMyTimetable);
router.get("/my-curriculum", protect, getMyCurriculum);
router.patch("/register-subjects", protect, updateMySubjectSelections);

export default router;
