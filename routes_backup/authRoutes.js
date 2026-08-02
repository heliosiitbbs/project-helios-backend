import express from "express";
import rateLimit from "express-rate-limit";

import {
    loginUser,
    updateInitialPassword,
    checkAccountStatus,
    sendAuthVerification,
    verifyAuthCode,
    registerOrUpdateUserPin
} from "../controllers/authController.js";

const router = express.Router();

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many attempts. Please try again later."
    }
});

router.post(
    "/login",
    authLimiter,
    loginUser
);

router.post(
    "/update-password",
    authLimiter,
    updateInitialPassword
);

router.post(
    "/check-account",
    authLimiter,
    checkAccountStatus
);

router.post(
    "/send-verification-code",
    authLimiter,
    sendAuthVerification
);

router.post(
    "/verify-code",
    authLimiter,
    verifyAuthCode
);

router.post(
    "/setup-pin",
    authLimiter,
    registerOrUpdateUserPin
);

export default router;
