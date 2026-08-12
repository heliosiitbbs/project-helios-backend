import express from "express";

import {
    getBusSchedule,
    addBusSchedule,
    getAllBusSchedules,
    getExternalTransportContacts
} from "../controllers/busController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post(
    "/get-bus-schedule",
    protect,
    getBusSchedule
);

router.post(
    "/add-bus-schedule",
    protect,
    authorize('Admin'),
    addBusSchedule
);

router.get(
    "/all-schedules",
    protect,
    authorize('Admin'),
    getAllBusSchedules
);

router.get(
    "/external-transport",
    protect,
    getExternalTransportContacts
);

export default router;