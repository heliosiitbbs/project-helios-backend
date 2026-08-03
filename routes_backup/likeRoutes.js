import express from "express";

import {
    getPostLikes,
    likePost,
    unlikePost
} from "../controllers/likeController.js";

const router = express.Router();

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
