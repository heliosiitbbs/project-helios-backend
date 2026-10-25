import express from "express";
import {
    getStudentByRollNumber,
    updateStudentCredentials,
    getStudentStats,
    adminListStudents,
    getStudentSubjects,
    addStudentSubject,
    removeStudentSubject,
    searchSubjectCatalog
} from "../controllers/studentController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Every route here reads or edits other students' records - admin roles only
router.use(protect, authorize("Admin", "Super Admin"));

// Admin dashboard (MUST come before /:rollNumber)
router.get("/admin-list", adminListStudents);
router.get("/subject-catalog", searchSubjectCatalog);
router.get("/stats", getStudentStats);
router.get("/:rollNumber/subjects", getStudentSubjects);
router.post("/:rollNumber/subjects", addStudentSubject);
router.delete("/:rollNumber/subjects/:registrationId", removeStudentSubject);

router.get("/:rollNumber", getStudentByRollNumber);
router.put("/:rollNumber", updateStudentCredentials);

export default router;
