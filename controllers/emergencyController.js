import jwt from "jsonwebtoken";
import supabase from "../config/Supabase.js";

// =====================================
// GET EMERGENCY CONTACTS
// =====================================

export const getEmergencyContacts = async (req, res) => {
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

        const { data, error } = await supabase
            .from("emergency_contacts")
            .select(`
                category,
                Office_Staff_Details!Officer_id(
                    Designation,
                    Location,
                    User_Details!user_code(
                        "User Name",
                        email_id,
                        phone_number
                    )
                )
            `);

        if (error) throw error;

        const contacts = data.map((contact) => ({
            category: contact.category,
            name:
                contact.Office_Staff_Details.User_Details["User Name"],

            designation:
                `${contact.Office_Staff_Details.Designation} (${contact.Office_Staff_Details.Location})`,

            email:
                contact.Office_Staff_Details.User_Details.email_id,

            phone_number:
                contact.Office_Staff_Details.User_Details.phone_number
        }));

        return res.status(200).json({
            success: true,
            userType: decoded.user_type,
            contacts
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
};

