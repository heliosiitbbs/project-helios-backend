import express from "express";

import {
    getPostComments,
    addPostComment,
    deletePostComment
} from "../controllers/commentController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get(
    "/:id/comments",
    protect,
    getPostComments
);

router.post(
    "/:id/comments",
    protect,
    addPostComment
);

router.delete(
    "/:id/comments/:commentId",
    protect,
    deletePostComment
);

export default router;
