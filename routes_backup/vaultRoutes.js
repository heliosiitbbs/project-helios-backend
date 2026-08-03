import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
    listResources,
    getResource,
    getAvailableSlots,
    createItemBooking,
    getMyItemBookings,
    cancelOrReturnItemBooking,
    createCourtBooking,
    getMyCourtBookings,
    cancelCourtBooking,
    searchUsers
} from "../controllers/vaultController.js";

const router = express.Router();

router.use(protect);

router.get("/resources", listResources);
router.get("/resources/:id", getResource);
router.get("/resources/:id/slots", getAvailableSlots);

router.post("/item-bookings", createItemBooking);
router.get("/item-bookings/my", getMyItemBookings);
router.delete("/item-bookings/:id", cancelOrReturnItemBooking);

router.post("/court-bookings", createCourtBooking);
router.get("/court-bookings/my", getMyCourtBookings);
router.delete("/court-bookings/:id", cancelCourtBooking);

router.get("/users/search", searchUsers);

export default router;
