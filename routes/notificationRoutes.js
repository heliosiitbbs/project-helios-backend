import express from "express";
import { registerPushToken, getMyNotifications, dismissNotification } from "../controllers/notificationController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/register-token", protect, registerPushToken);
router.get("/", protect, getMyNotifications);
router.delete("/:id", protect, dismissNotification);

export default router;
