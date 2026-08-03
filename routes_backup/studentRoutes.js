import express from "express";
import multer from "multer";
import {
    uploadStudents,
    updateStudentRooms,
    invalidateStudents,
    updateFacultyAdvisers,
    updateFacultyAdviserByRollNumber,
    invalidateStudentByRollNumber,
    getAllStudents,
    getStudentByRollNumber,
    searchStudents,
    filterStudents,
    updateStudentHostel,
    updateStudentRoom,
    updateStudentCredentials,
    getStudentStats,
    getStudentsByHostel,
    getStudentsBySemester,
    bulkUpdateStudents,
    exportStudents
} from "../controllers/studentController.js";
import { protect } from "../middlewares/authMiddleware.js";

const upload = multer({
    storage: multer.memoryStorage()
});

const router = express.Router();

// Specific query/named routes (MUST come before /:rollNumber)
router.get("/stats", protect, getStudentStats);
router.get("/search", protect, searchStudents);
router.get("/filter", protect, filterStudents);
router.get("/export", protect, exportStudents);
router.get("/hostel/:hostel", protect, getStudentsByHostel);
router.get("/semester/:semester", protect, getStudentsBySemester);

// Bulk operations
router.put("/bulk-update", protect, bulkUpdateStudents);

// Field-specific update routes (MUST come before generic /:rollNumber)
router.put("/:rollNumber/hostel", protect, updateStudentHostel);
router.put("/:rollNumber/room", protect, updateStudentRoom);
router.put("/:rollNumber/faculty-adviser", protect, updateFacultyAdviserByRollNumber);

// Root CRUD routes
router.get("/", protect, getAllStudents);
router.put("/:rollNumber", protect, updateStudentCredentials);
router.get("/:rollNumber", protect, getStudentByRollNumber);

// Excel Upload / Legacy Batch Operations
router.post("/upload-students", protect, upload.single("file"), uploadStudents);
router.post("/update-hostel-rooms", protect, upload.single("file"), updateStudentRooms);
router.post("/invalidate-students", protect, upload.single("file"), invalidateStudents);
router.post("/update-faculty-advisers", protect, upload.single("file"), updateFacultyAdvisers);
router.post("/update-faculty-adviser-by-roll-number", protect, updateFacultyAdviserByRollNumber);
router.post("/invalidate-student-by-roll-number", protect, invalidateStudentByRollNumber);

export default router;