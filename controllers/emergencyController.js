import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";

// Must match the public.emergency_categories enum exactly
const VALID_CATEGORIES = ["Security", "Medical", "Hostel", "Guest House"];

// Contacts are standalone rows (name/designation/location/phone/email stored on
// emergency_contacts itself), so units like "Main Gate Security" need no user account.
const CONTACT_COLUMNS = "id, category, name, designation, location, phone_number, email_id";

function flattenContact(row) {
    return {
        id: row.id,
        category: row.category,
        name: row.name || "Unknown",
        department: row.designation || null,
        location: row.location || null,
        email: row.email_id || null,
        phone: row.phone_number || null
    };
}

// Turns optional blank strings into nulls so cleared fields don't store ""
const orNull = (value) => (typeof value === "string" && value.trim() === "" ? null : value);

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
            .select(CONTACT_COLUMNS)
            .order("id", { ascending: true });

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
// Takes name/phone/email directly (admin dashboard), or a user_id whose
// account details get copied in (the mobile app's pick-a-user flow).

export const addEmergencyContact = async (req, res) => {
    try {
        const { category, user_id, designation, location } = req.body;
        let { name, phone, email } = req.body;

        if (!VALID_CATEGORIES.includes(category)) {
            return res.status(400).json({
                success: false,
                message: `category must be one of: ${VALID_CATEGORIES.join(", ")}`
            });
        }

        if (user_id) {
            const { data: user, error: userError } = await supabase
                .from("User_Details")
                .select(`"User Name", email_id, phone_number`)
                .eq("id", user_id)
                .maybeSingle();

            if (userError) throw userError;
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            name = name || user["User Name"];
            email = email || user.email_id;
            phone = phone || user.phone_number;
        }

        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: "name (or user_id) is required."
            });
        }

        const { data: contact, error: insertError } = await supabase
            .from("emergency_contacts")
            .insert([{
                category,
                name: name.trim(),
                designation: orNull(designation) ?? null,
                location: orNull(location) ?? null,
                phone_number: orNull(phone) ?? null,
                email_id: orNull(email) ?? null
            }])
            .select(CONTACT_COLUMNS)
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
// UPDATE EMERGENCY CONTACT (ADMIN ONLY)
// =====================================

export const updateEmergencyContact = async (req, res) => {
    try {
        const { category, name, designation, location, phone, email } = req.body;

        if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
            return res.status(400).json({
                success: false,
                message: `category must be one of: ${VALID_CATEGORIES.join(", ")}`
            });
        }

        if (name !== undefined && !name.trim()) {
            return res.status(400).json({ success: false, message: "name cannot be empty." });
        }

        const updateData = {};
        if (category !== undefined) updateData.category = category;
        if (name !== undefined) updateData.name = name.trim();
        if (designation !== undefined) updateData.designation = orNull(designation);
        if (location !== undefined) updateData.location = orNull(location);
        if (phone !== undefined) updateData.phone_number = orNull(phone);
        if (email !== undefined) updateData.email_id = orNull(email);

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ success: false, message: "No fields provided for update" });
        }

        const { data, error } = await supabase
            .from("emergency_contacts")
            .update(updateData)
            .eq("id", req.params.id)
            .select(CONTACT_COLUMNS);

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.status(404).json({ success: false, message: "Emergency contact not found" });
        }

        await redis.del("emergency-contacts:all");

        return res.status(200).json({
            success: true,
            message: "Emergency contact updated successfully",
            contact: flattenContact(data[0])
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
