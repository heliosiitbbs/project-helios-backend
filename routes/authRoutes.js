import express from "express";

import {
    loginUser,
    updateInitialPassword
} from "../controllers/authController.js";

const router = express.Router();

router.post(
    "/login",
    loginUser
);

router.post(
    "/update-password",
    updateInitialPassword
);

export default router;
