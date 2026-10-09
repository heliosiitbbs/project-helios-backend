import express from "express";
import {
  getAllRides,
  createRide,
  joinRide,
  getMyRides
} from "../controllers/cabSharingController.js";

const router = express.Router();

router.get("/rides", getAllRides);
router.post("/rides", createRide);
router.post("/rides/:id/join", joinRide);
router.get("/my-rides", getMyRides);

export default router;
