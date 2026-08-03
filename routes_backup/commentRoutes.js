import express from "express";

import {
    getPostComments,
    addPostComment,
    deletePostComment
} from "../controllers/commentController.js";

const router = express.Router();

router.get(
    "/:id/comments",
    getPostComments
);

router.post(
    "/:id/comments",
    addPostComment
);

router.delete(
    "/:id/comments/:commentId",
    deletePostComment
);

export default router;
