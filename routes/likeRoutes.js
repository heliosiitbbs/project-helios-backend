import express from "express";

import {
    getPostLikes,
    likePost,
    unlikePost
} from "../controllers/likeController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get(
    "/:id/likes",
    protect,
    getPostLikes
);

router.post(
    "/:id/like",
    protect,
    likePost
);

router.delete(
    "/:id/like",
    protect,
    unlikePost
);

export default router;
