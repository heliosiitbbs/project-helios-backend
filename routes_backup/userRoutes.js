import express from "express";
import multer from "multer";
import { getMyProfile, updatePhoneNumber, updateBloodGroup, uploadUserPhoto, changePin } from "../controllers/userController.js";
import { protect } from "../middlewares/authMiddleware.js";
const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024 // 2 MB
  }
});
router.get("/me", protect, getMyProfile);
router.patch("/update-phone-number", protect,updatePhoneNumber);
router.patch("/update-blood-group", protect, updateBloodGroup);
router.patch("/change-pin", protect, changePin);


router.patch("/upload-photo",protect,upload.single("photo"),uploadUserPhoto);
export default router;


