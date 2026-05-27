import express from 'express';
import {getMenu, getFullWeekMenuByHostel} from '../controllers/menuController.js';
const router = express.Router();

router.get('/get-menu', getMenu);
router.post('/get-full-week-menu', getFullWeekMenuByHostel);
export default router;