import express from "express";
import {
    addStudent,
    previewStudents,
    addStudentsBulk,
    listVisitors,
    addVisitor,
    previewVisitors,
    addVisitorsBulk
} from "../controllers/peopleController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";
import uploadSpreadsheet from "../middlewares/uploadSpreadsheet.js";

const router = express.Router();

// Adding students and visitors is a Super Admin job
router.use(protect, authorize("Super Admin"));

router.post("/students", addStudent);
router.post("/students/preview", uploadSpreadsheet.single("file"), previewStudents);
router.post("/students/bulk", addStudentsBulk);
router.get("/visitors", listVisitors);
router.post("/visitors", addVisitor);
router.post("/visitors/preview", uploadSpreadsheet.single("file"), previewVisitors);
router.post("/visitors/bulk", addVisitorsBulk);

export default router;
