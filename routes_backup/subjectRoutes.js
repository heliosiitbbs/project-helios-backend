import express from 'express';
import multer from 'multer';
import { addSubjects, getSubjescts, uploadSubjects } from '../controllers/subjectController.js';
import { protect,authorize } from '../middlewares/authMiddleware.js';
const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage()
});
router.post('/add-subject', protect, authorize('Admin'), addSubjects);
router.get('/get-subjects', protect, authorize('Admin'), getSubjescts);
router.post("/upload-subjects", upload.single("file"), uploadSubjects);
export default router;