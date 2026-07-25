import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import uploadGuestHouseDocs from "../middlewares/uploadGuestHouseDocs.js";
import { createBooking, getMyBookings, getBlankForm } from "../controllers/guestHouseController.js";

const router = express.Router();

router.post(
    "/create-booking",
    protect,
    uploadGuestHouseDocs.fields([
        { name: "visitor_id_card", maxCount: 1 },
        { name: "approval_proof", maxCount: 1 }
    ]),
    createBooking
);

router.get("/my-bookings", protect, getMyBookings);
router.get("/blank-form", protect, getBlankForm);

export default router;
