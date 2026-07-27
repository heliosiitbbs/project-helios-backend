import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";

// Must match the public.emergency_categories enum exactly
const VALID_CATEGORIES = ["Security", "Medical", "Hostel", "Guest House"];

function flattenContact(row) {
    const officer = row.Office_Staff_Details;
    const user = officer?.User_Details;
    return {
        id: row.id,
        category: row.category,
        name: user?.["User Name"] || "Unknown",
        department: officer?.Designation || null,
        location: officer?.Location || null,
        email: user?.email_id || null,
        phone: user?.phone_number || null
    };
}

// =====================================
// GET ALL EMERGENCY CONTACTS
// =====================================

export const getEmergencyContacts = async (req, res) => {
    try {
        const cacheKey = "emergency-contacts:all";

        const cachedData = await redis.get(cacheKey);

        if (cachedData) {
            return res.status(200).json({
                success: true,
                source: "redis",
                contacts: cachedData
            });
        }

        const { data, error } = await supabase
            .from("emergency_contacts")
            .select(`
                id,
                category,
                Office_Staff_Details (
                    Designation,
                    Location,
                    User_Details (
                        "User Name",
                        email_id,
                        phone_number
                    )
                )
            `);

        if (error) throw error;

        const contacts = data.map(flattenContact);

        await redis.set(cacheKey, contacts, { ex: 3600 });

        return res.status(200).json({
            success: true,
            source: "supabase",
            contacts
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// =====================================
// ADD EMERGENCY CONTACT (ADMIN ONLY)
// =====================================
// Links a category to an existing User_Details account, creating (or reusing)
// its Office_Staff_Details row along the way.

export const addEmergencyContact = async (req, res) => {
    try {
        const { category, user_id, designation, location } = req.body;

        if (!category || !user_id || !designation || !location) {
            return res.status(400).json({
                success: false,
                message: "category, user_id, designation and location are required."
            });
        }

        if (!VALID_CATEGORIES.includes(category)) {
            return res.status(400).json({
                success: false,
                message: `category must be one of: ${VALID_CATEGORIES.join(", ")}`
            });
        }

        // Find or create the Office_Staff_Details row for this user
        const { data: existingOfficer, error: findError } = await supabase
            .from("Office_Staff_Details")
            .select("id")
            .eq("user_code", user_id)
            .maybeSingle();

        if (findError) throw findError;

        let officerId = existingOfficer?.id;

        if (!officerId) {
            const { data: newOfficer, error: createError } = await supabase
                .from("Office_Staff_Details")
                .insert([{ user_code: user_id, Designation: designation, Location: location }])
                .select("id")
                .single();

            if (createError) throw createError;
            officerId = newOfficer.id;
        }

        const { data: contact, error: insertError } = await supabase
            .from("emergency_contacts")
            .insert([{ category, Officer_id: officerId }])
            .select(`
                id,
                category,
                Office_Staff_Details (
                    Designation,
                    Location,
                    User_Details (
                        "User Name",
                        email_id,
                        phone_number
                    )
                )
            `)
            .single();

        if (insertError) throw insertError;

        await redis.del("emergency-contacts:all");

        return res.status(201).json({
            success: true,
            message: "Emergency contact added successfully",
            contact: flattenContact(contact)
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// =====================================
// REMOVE EMERGENCY CONTACT (ADMIN ONLY)
// =====================================

export const removeEmergencyContact = async (req, res) => {
    try {
        const { error } = await supabase
            .from("emergency_contacts")
            .delete()
            .eq("id", req.params.id);

        if (error) throw error;

        await redis.del("emergency-contacts:all");

        return res.status(200).json({ success: true, message: "Emergency contact removed" });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};
