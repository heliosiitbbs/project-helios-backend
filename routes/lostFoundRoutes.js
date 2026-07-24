import express from "express";

import upload
from "../middlewares/uploadLostItem.js";

import { protect } from "../middlewares/authMiddleware.js";

import {
reportLostItem,
getLostItems,
reportResolved
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