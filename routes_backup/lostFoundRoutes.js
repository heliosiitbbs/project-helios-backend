import express from "express";

import upload
from "../middlewares/uploadLostItem.js";

import { protect } from "../middlewares/authMiddleware.js";

import {
reportLostItem,
getLostItems,
reportResolved,
sendHandoverOTP
}
from "../controllers/lostFoundController.js";

const router=
express.Router();

router.post(
"/report-lost-item",
protect,
upload.single("photo"),
reportLostItem
);

router.post(
"/send-otp",
protect,
sendHandoverOTP
);

router.get(
"/get-lost-items",
protect,
getLostItems
);

router.post(
"/report-resolved",
protect,
reportResolved
);

export default router;