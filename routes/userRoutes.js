import express from "express";
import multer from "multer";
import { getMyProfile, updatePhoneNumber, updateBloodGroup, uploadUserPhoto, changePin, getAdmins, createAdmin, updateAdmin, updateUserExpiry } from "../controllers/userController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";
const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024 // 2 MB
  }
});
router.get("/me", protect, getMyProfile);
router.get("/admins", protect, authorize("Super Admin"), getAdmins);
router.post("/admins", protect, authorize("Super Admin"), createAdmin);
router.patch("/admins/:id", protect, authorize("Super Admin"), updateAdmin);
router.patch("/update-phone-number", protect,updatePhoneNumber);
router.patch("/update-blood-group", protect, updateBloodGroup);
router.patch("/change-pin", protect, changePin);
router.patch("/update-expiry", protect, updateUserExpiry);

router.patch("/upload-photo",protect,upload.single("photo"),uploadUserPhoto);
export default router;


