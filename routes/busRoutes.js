import express from "express";

import {
    getBusSchedule,
    getExternalTransportContacts
} from "../controllers/busController.js";
import {
    getFleet,
    addFleetBus,
    updateFleetBus,
    deleteFleetBus,
    getRegularSchedule,
    exportRegularSchedule,
    previewRegularUpload,
    applyRegularUpload,
    listDatePlans,
    getDatePlan,
    saveDatePlan
} from "../controllers/busAdminController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";
import uploadSpreadsheet from "../middlewares/uploadSpreadsheet.js";

const router = express.Router();

router.post(
    "/get-bus-schedule",
    protect,
    getBusSchedule
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

// Regular schedule: read one plan, save a whole plan (timeline editor or Excel upload)
router.get("/admin/regular", ...transportAdmin, getRegularSchedule);
router.get("/admin/regular/export", ...transportAdmin, exportRegularSchedule);
router.post("/admin/regular/preview", ...transportAdmin, uploadSpreadsheet.single("file"), previewRegularUpload);
router.post("/admin/regular/apply", ...transportAdmin, applyRegularUpload);

// One-off schedules for a single date
router.get("/admin/dates", ...transportAdmin, listDatePlans);
router.get("/admin/dates/:date", ...transportAdmin, getDatePlan);
router.put("/admin/dates/:date/trips", ...transportAdmin, saveDatePlan);

export default router;
