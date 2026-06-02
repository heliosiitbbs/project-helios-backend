import express from 'express';
import {getMenu, getFullWeekMenuByHostel,editMessFoodItems,uploadFullMessMenu} from '../controllers/menuController.js';
import { protect, authorize } from '../middlewares/authMiddleware.js';
const router = express.Router();

router.post('/get-menu',protect, getMenu);
router.post('/get-full-week-menu', protect, authorize('Admin'), getFullWeekMenuByHostel);
router.post('/upload-full-mess-menu', protect, authorize('Admin'), uploadFullMessMenu);
router.post("/edit-mess", protect, authorize('Admin'), editMessFoodItems);
// add-mess
export default router;