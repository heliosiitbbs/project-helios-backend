import express from 'express';
import {getMenu, getFullWeekMenuByHostel,editMessFoodItems} from '../controllers/menuController.js';
import { protect, authorize } from '../middlewares/authMiddleware.js';
const router = express.Router();

router.post('/get-menu', getMenu);
router.post('/get-full-week-menu', protect, authorize('Admin'), getFullWeekMenuByHostel);
router.post("/edit-mess", protect, authorize('Admin'), editMessFoodItems);
export default router;