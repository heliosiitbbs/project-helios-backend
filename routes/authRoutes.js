import express from "express";

import {
    loginUser,
    updateInitialPassword,
    checkAccountStatus,
    sendAuthVerification,
    verifyAuthCode,
    registerOrUpdateUserPin
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

router.post(
    "/check-account",
    checkAccountStatus
);

router.post(
    "/send-verification-code",
    sendAuthVerification
);

router.post(
    "/verify-code",
    verifyAuthCode
);

router.post(
    "/setup-pin",
    registerOrUpdateUserPin
);

export default router;
