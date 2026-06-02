import { uploadStudents, updateStudentRooms, invalidateStudents, updateFacultyAdvisers, updateFacultyAdviserByRollNumber,invalidateStudentByRollNumber } from "../controllers/studentController.js";

import express from "express";
import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage()
});
const router = express.Router();
router.post("/upload-students", upload.single("file"), uploadStudents);
router.post("/update-hostel-rooms",upload.single("file"), updateStudentRooms);
router.post("/invalidate-students", upload.single("file"), invalidateStudents);
router.post("/update-faculty-advisers", upload.single("file"), updateFacultyAdvisers);
router.post("/update-faculty-adviser-by-roll-number", updateFacultyAdviserByRollNumber);
router.post("/invalidate-student-by-roll-number", invalidateStudentByRollNumber);
export default router;