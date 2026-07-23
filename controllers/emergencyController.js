import jwt from "jsonwebtoken";
import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";

// =====================================
// GET ALL EMERGENCY CONTACTS
// =====================================

export const getEmergencyContacts = async (req, res) => {
    try {
    

        const authHeader = req.headers.authorization;

        if (
            !authHeader ||
            !authHeader.startsWith("Bearer ")
        ) {
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

        const cacheKey = "emergency-contacts";

        const cachedData = await redis.get(cacheKey);

        if (cachedData) {
            return res.status(200).json({
                success: true,
                source: "redis",
                contacts: cachedData
            });
        }

        const { data, error } = await supabase
            .from("User_Details")
            .select(`
                "User Name",
                email_id,
                phone_number
            `)
            .eq(
                "is_emergency_number",
                true
            );

        if (error) throw error;

        await redis.set(
            cacheKey,
            data,
            {
                ex: 3600
            }
        );

        return res.status(200).json({
            success: true,
            source: "supabase",
            contacts: data
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
// EDIT EMERGENCY CONTACT STATUS
// ADMIN ONLY
// =====================================

export const editEmergencyContact = async (req, res) => {
    try {

        const authHeader = req.headers.authorization;

        if (
            !authHeader ||
            !authHeader.startsWith("Bearer ")
        ) {
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

        if (
            decoded.user_type !== "Admin"
        ) {
            return res.status(403).json({
                success: false,
                message: "Admin access required"
            });
        }

        const {
            email_id,
            is_emergency_number
        } = req.body;

        if (
            email_id === undefined ||
            is_emergency_number === undefined
        ) {
            return res.status(400).json({
                success: false,
                message: "email_id and is_emergency_number are required"
            });
        }

        const { data, error } = await supabase
            .from("User_Details")
            .update({
                is_emergency_number
            })
            .eq(
                "email_id",
                email_id
            )
            .select(`
                "User Name",
                email_id,
                phone_number,
                is_emergency_number
            `);

        if (error) throw error;

        // Clear Redis cache
        await redis.del(
            "emergency-contacts"
        );

        return res.status(200).json({
            success: true,
            message: "Emergency contact updated successfully",
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