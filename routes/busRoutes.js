import express from "express";

import {
    getBusSchedule,
    addBusSchedule,
    getAllBusSchedules
} from "../controllers/busController.js";

const router = express.Router();

router.post(
    "/get-bus-schedule",
    getBusSchedule
);

router.post(
    "/add-bus-schedule",
    addBusSchedule
);

router.get(
    "/all-schedules",
    getAllBusSchedules
);

export default router;