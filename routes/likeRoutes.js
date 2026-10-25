import express from "express";
import { protect } from "../middlewares/authMiddleware.js";

import {
    getPostLikes,
    likePost,
    unlikePost
} from "../controllers/likeController.js";

const router = express.Router();

router.use(protect);

router.get(
    "/:id/likes",
    getPostLikes
);

router.post(
    "/:id/like",
    likePost
);

router.delete(
    "/:id/like",
    unlikePost
);

export default router;
