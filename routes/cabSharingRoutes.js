import express from "express";
import { protect, authorize } from "../middlewares/authMiddleware.js";
import {
  getAllRides,
  getMyRides,
  getRide,
  createRide,
  joinRide,
  respondToRequest,
  leaveRide,
  cancelRide
} from "../controllers/cabSharingController.js";

const router = express.Router();

// Ride sharing is between students
router.use(protect, authorize("Student"));

router.get("/rides", getAllRides);
router.post("/rides", createRide);
router.get("/my-rides", getMyRides);
router.get("/rides/:id", getRide);
router.post("/rides/:id/join", joinRide);
router.post("/rides/:id/requests/:memberId", respondToRequest);
router.post("/rides/:id/leave", leaveRide);
router.post("/rides/:id/cancel", cancelRide);

export default router;
