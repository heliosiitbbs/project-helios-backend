import jwt from "jsonwebtoken";
import supabase from "../config/Supabase.js";

// =====================================
// GET COMMENTS FOR A POST
// =====================================

export const getPostComments = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Access token missing"
            });
        }

        const token = authHeader.split(" ")[1];

        jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Post id is required"
            });
        }

        const { data, error } =
            await supabase
                .from("Post_Comments")
                .select("*")
                .eq("post_id", id)
                .order("created_at", {
                    ascending: false
                });

        if (error) throw error;

        return res.status(200).json({
            success: true,
            postId: id,
            comments: data
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
};

// =====================================
// ADD COMMENT TO A POST
// =====================================

export const addPostComment = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Access token missing"
            });
        }

        const token = authHeader.split(" ")[1];

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        const { id } = req.params;
        const { comment } = req.body;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Post id is required"
            });
        }

        if (
            typeof comment !== "string" ||
            !comment.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: "Comment is required"
            });
        }

        const rollnumber = decoded.rollnumber;

        if (!rollnumber) {
            return res.status(400).json({
                success: false,
                message: "Roll number not found in token"
            });
        }

        const {
            data: studentDetails,
            error: studentError
        } = await supabase
            .from("Student_Details")
            .select("User_code")
            .eq("Roll Number", rollnumber)
            .single();

        if (studentError || !studentDetails) {
            return res.status(404).json({
                success: false,
                message: "Student details not found"
            });
        }

        const {
            data: userDetails,
            error: userError
        } = await supabase
            .from("User_Details")
            .select("*")
            .eq("id", studentDetails.User_code)
            .single();

        if (userError || !userDetails) {
            return res.status(404).json({
                success: false,
                message: "User details not found"
            });
        }

        const userId = userDetails.id;

        const { data, error } =
            await supabase
                .from("Post_Comments")
                .insert([
                    {
                        post_id: id,
                        user_id: userId,
                        comment: comment.trim()
                    }
                ])
                .select();

        if (error) throw error;

        return res.status(201).json({
            success: true,
            message: "Comment added successfully",
            data
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
};

// =====================================
// DELETE COMMENT FROM A POST
// =====================================

export const deletePostComment = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Access token missing"
            });
        }

        const token = authHeader.split(" ")[1];

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        const {
            id,
            commentId
        } = req.params;

        if (!id || !commentId) {
            return res.status(400).json({
                success: false,
                message: "Post id and comment id are required"
            });
        }

        const {
            data: existingComment,
            error: existingCommentError
        } = await supabase
            .from("Post_Comments")
            .select("*")
            .eq("id", commentId)
            .eq("post_id", id)
            .maybeSingle();

        if (existingCommentError) {
            throw existingCommentError;
        }

        if (!existingComment) {
            return res.status(404).json({
                success: false,
                message: "Comment not found"
            });
        }

        if (decoded.user_type !== "Admin") {
            const rollnumber = decoded.rollnumber;

            if (!rollnumber) {
                return res.status(400).json({
                    success: false,
                    message: "Roll number not found in token"
                });
            }

            const {
                data: studentDetails,
                error: studentError
            } = await supabase
                .from("Student_Details")
                .select("User_code")
                .eq("Roll Number", rollnumber)
                .single();

            if (studentError || !studentDetails) {
                return res.status(404).json({
                    success: false,
                    message: "Student details not found"
                });
            }

            const {
                data: userDetails,
                error: userError
            } = await supabase
                .from("User_Details")
                .select("*")
                .eq("id", studentDetails.User_code)
                .single();

            if (userError || !userDetails) {
                return res.status(404).json({
                    success: false,
                    message: "User details not found"
                });
            }

            if (
                String(existingComment.user_id) !==
                String(userDetails.id)
            ) {
                return res.status(403).json({
                    success: false,
                    message: "You can delete only your own comments"
                });
            }
        }

        const { data, error } =
            await supabase
                .from("Post_Comments")
                .delete()
                .eq("id", commentId)
                .eq("post_id", id)
                .select();

        if (error) throw error;

        return res.status(200).json({
            success: true,
            message: "Comment deleted successfully",
            data
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
};
