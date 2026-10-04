import express from "express";

import {
    getAllWebsites,
    getWebsiteByName,
    addWebsite,
    deleteWebsite
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

router.delete(
    "/delete-website/:id",
    protect,
    authorize('Admin'),
    deleteWebsite
);

export default router;