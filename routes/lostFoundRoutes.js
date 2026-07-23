import express from "express";

import upload
from "../middlewares/uploadLostItem.js";

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
upload.single("photo"),
reportLostItem
);

router.get(
"/get-lost-items",
getLostItems
);

router.post(
"/report-resolved",
reportResolved
);

export default router;