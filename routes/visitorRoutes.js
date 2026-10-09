import express from "express";
import { protect, authorize } from "../middlewares/authMiddleware.js";
import { registerVisitor } from "../controllers/visitorController.js";

const router = express.Router();

router.post("/", protect, authorize("Admin", "Super Admin"), registerVisitor);

export default router;

