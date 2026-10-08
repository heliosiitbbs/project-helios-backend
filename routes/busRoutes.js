import express from "express";

import {
    getBusSchedule,
    addBusSchedule,
    getAllBusSchedules,
    getExternalTransportContacts
} from "../controllers/busController.js";
import {
    getFleet,
    addFleetBus,
    updateFleetBus,
    deleteFleetBus,
    getRegularSchedule,
    addRegularTrip,
    updateRegularTrip,
    removeRegularTrip,
    listDatePlans,
    getDatePlan,
    createDatePlan,
    updateDatePlan,
    deleteDatePlan,
    addDateTrip,
    updateDateTrip,
    deleteDateTrip,
    cancelBusForDate
} from "../controllers/busAdminController.js";
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

// Transport Admin console
const transportAdmin = [protect, authorize("Transport Admin", "Super Admin")];
router.get("/admin/fleet", ...transportAdmin, getFleet);
router.post("/admin/fleet", ...transportAdmin, addFleetBus);
router.patch("/admin/fleet/:bus", ...transportAdmin, updateFleetBus);
router.delete("/admin/fleet/:bus", ...transportAdmin, deleteFleetBus);

router.get("/admin/regular", ...transportAdmin, getRegularSchedule);
router.post("/admin/regular", ...transportAdmin, addRegularTrip);
router.put("/admin/regular", ...transportAdmin, updateRegularTrip);
router.post("/admin/regular/remove", ...transportAdmin, removeRegularTrip);

router.get("/admin/dates", ...transportAdmin, listDatePlans);
router.get("/admin/dates/:date", ...transportAdmin, getDatePlan);
router.post("/admin/dates/:date", ...transportAdmin, createDatePlan);
router.patch("/admin/dates/:date", ...transportAdmin, updateDatePlan);
router.delete("/admin/dates/:date", ...transportAdmin, deleteDatePlan);
router.post("/admin/dates/:date/trips", ...transportAdmin, addDateTrip);
router.post("/admin/dates/:date/cancel-bus", ...transportAdmin, cancelBusForDate);
router.patch("/admin/dates/:date/trips/:id", ...transportAdmin, updateDateTrip);
router.delete("/admin/dates/:date/trips/:id", ...transportAdmin, deleteDateTrip);

export default router;
