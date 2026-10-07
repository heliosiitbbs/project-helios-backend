import express from "express";

import {
    getAllWebsites,
    getWebsiteByName,
    addWebsite,
    updateWebsite,
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
    authorize('Admin', 'Super Admin'),
    addWebsite
);

router.put(
    "/update-website/:id",
    protect,
    authorize('Admin', 'Super Admin'),
    updateWebsite
);

router.delete(
    "/delete-website/:id",
    protect,
    authorize('Admin', 'Super Admin'),
    deleteWebsite
);

export default router;