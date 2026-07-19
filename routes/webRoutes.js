import express from "express";

import {
    getAllWebsites,
    getWebsiteByName,
    addWebsite
} from "../controllers/webController.js";

const router = express.Router();

router.get(
    "/all-websites",
    getAllWebsites
);

router.get(
    "/website/:website_name",
    getWebsiteByName
);

router.post(
    "/add-website",
    addWebsite
);

export default router;