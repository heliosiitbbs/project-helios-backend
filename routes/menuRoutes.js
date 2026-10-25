import express from 'express';
import { getMenu } from '../controllers/menuController.js';
import { protect } from '../middlewares/authMiddleware.js';
const router = express.Router();

router.post('/get-menu',protect, getMenu);

export default router;