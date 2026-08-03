import jwt from "jsonwebtoken";
import supabase from "../config/Supabase.js";

// =====================================
// GET LIKES FOR A POST
// =====================================

export const getPostLikes = async (req, res) => {
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

        const { count, error } =
            await supabase
                .from("Post_Likes")
                .select("*", {
                    count: "exact",
                    head: true
                })
                .eq("post_id", id);

        if (error) throw error;

        return res.status(200).json({
            success: true,
            postId: id,
            likes: count
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
// LIKE A POST
// =====================================

export const likePost = async (req, res) => {
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

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Post id is required"
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

        const {
            data: existingLike,
            error: existingLikeError
        } = await supabase
            .from("Post_Likes")
            .select("*")
            .eq("post_id", id)
            .eq("user_id", userId)
            .maybeSingle();

        if (existingLikeError) {
            throw existingLikeError;
        }

        if (existingLike) {
            return res.status(409).json({
                success: false,
                message: "Post already liked"
            });
        }

        const { data, error } =
            await supabase
                .from("Post_Likes")
                .insert([
                    {
                        post_id: id,
                        user_id: userId
                    }
                ])
                .select();

        if (error) throw error;

        return res.status(201).json({
            success: true,
            message: "Post liked successfully",
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
// REMOVE LIKE FROM A POST
// =====================================

export const unlikePost = async (req, res) => {
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

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Post id is required"
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
                .from("Post_Likes")
                .delete()
                .eq("post_id", id)
                .eq("user_id", userId)
                .select();

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Like not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Like removed successfully",
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
