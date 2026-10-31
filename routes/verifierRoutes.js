import express from "express";
import {
    verifierLogin,
    protectVerifier,
    getVerifierSession,
    verifierScanPass,
    listVerifiers,
    createVerifiers,
    resetVerifierPassword,
    deleteVerifier,
    getPassUsage
} from "../controllers/verifierController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Verifier accounts (app)
router.post("/login", verifierLogin);
router.get("/me", protectVerifier, getVerifierSession);
router.post("/scan", protectVerifier, verifierScanPass);

// Super Admin dashboard: Credentials -> Verifiers
const superAdmin = authorize("Super Admin");
router.get("/", protect, superAdmin, listVerifiers);
router.get("/usage/:eventId", protect, superAdmin, getPassUsage);
router.post("/", protect, superAdmin, createVerifiers);
router.post("/:id/reset-password", protect, superAdmin, resetVerifierPassword);
router.delete("/:id", protect, superAdmin, deleteVerifier);

export default router;
