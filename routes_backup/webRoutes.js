import express from "express";

import {
    getAllWebsites,
    getWebsiteByName,
    addWebsite
} from "../controllers/webController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get(
    "/all-websites",
    protect,
    getAllWebsites
);

router.get(
    "/website/:website_name",
    protect,
    getWebsiteByName
);

router.post(
    "/add-website",
    protect,
    authorize('Admin'),
    addWebsite
);

export default router;