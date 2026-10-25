import express from "express";
import multer from "multer";

import {
    loginUser,
    verifyGoogleSignIn,
    sendAuthVerification,
    verifyAuthCode,
    registerOrUpdateUserPin,
    completeProfile,
    refreshSession
} from "../controllers/authController.js";

const router = express.Router();

// Profile photo sent with the first-time profile form
const uploadProfilePhoto = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
            const err = new Error("Only JPG, PNG or WEBP photos are allowed");
            err.status = 400;
            err.publicMessage = err.message;
            return cb(err);
        }
        cb(null, true);
    }
});

router.post(
    "/login",
    loginUser
);

router.post(
    "/google-verify",
    verifyGoogleSignIn
);

router.post(
    "/send-verification-code",
    sendAuthVerification
);

router.post(
    "/verify-code",
    verifyAuthCode
);

// Needs the setup token from /google-verify or /verify-code
router.post(
    "/setup-pin",
    registerOrUpdateUserPin
);

// Needs a setup token or a session token
router.post(
    "/complete-profile",
    uploadProfilePhoto.single("photo"),
    completeProfile
);

// App session renewal (needs a still-valid app session token)
router.post(
    "/refresh",
    refreshSession
);

export default router;
