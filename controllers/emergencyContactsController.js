import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";

// =====================================
// 1. GET ALL EMERGENCY CONTACTS
// GET /api/emergency-contacts
// =====================================
export const getAllEmergencyContacts = async (req, res) => {
    try {
        const cacheKey = "emergency-contacts:all-contacts";

        try {
            const cachedData = await redis.get(cacheKey);
            if (cachedData) {
                return res.status(200).json({
                    success: true,
                    source: "redis",
                    contacts: cachedData
                });
            }
        } catch (cacheErr) {
            console.error("Redis Cache Error:", cacheErr);
        }

        const { data, error } = await supabase
            .from("emergency_contacts")
            .select(`
                id,
                category,
                Officer_id,
                Office_Staff_Details (
                    id,
                    Designation,
                    Location,
                    User_Details (
                        id,
                        "User Name",
                        email_id,
                        phone_number
                    )
                )
            `)
            .order("id", { ascending: true });

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error fetching emergency contacts"
            });
        }

        try {
            await redis.set(cacheKey, data, { ex: 3600 });
        } catch (cacheErr) {
            console.error("Redis Set Cache Error:", cacheErr);
        }

        return res.status(200).json({
            success: true,
            source: "supabase",
            contacts: data
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

// =====================================
// 2. CREATE EMERGENCY CONTACT
// POST /api/emergency-contacts
// =====================================
export const createEmergencyContact = async (req, res) => {
    try {
        const { category, Officer_id, officer_id } = req.body;
        const targetOfficerId = Officer_id !== undefined ? Officer_id : officer_id;

        if (!category || targetOfficerId === undefined) {
            return res.status(400).json({
                success: false,
                message: "category and Officer_id are required"
            });
        }

        const { data, error } = await supabase
            .from("emergency_contacts")
            .insert([
                {
                    category,
                    Officer_id: targetOfficerId
                }
            ])
            .select(`
                id,
                category,
                Officer_id,
                Office_Staff_Details (
                    id,
                    Designation,
                    Location,
                    User_Details (
                        id,
                        "User Name",
                        email_id,
                        phone_number
                    )
                )
            `)
            .single();

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error creating emergency contact"
            });
        }

        // Clear cache
        try {
            await redis.del("emergency-contacts:all-contacts");
            await redis.del("emergency-contacts:stats");
        } catch (cacheErr) {
            console.error("Redis Del Cache Error:", cacheErr);
        }

        return res.status(201).json({
            success: true,
            message: "Emergency contact created successfully",
            contact: data
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

// =====================================
// 3. UPDATE EMERGENCY CONTACT
// PUT /api/emergency-contacts/:id
// =====================================
export const updateEmergencyContact = async (req, res) => {
    try {
        const { id } = req.params;
        const { category, Officer_id, officer_id } = req.body;
        const targetOfficerId = Officer_id !== undefined ? Officer_id : officer_id;

        const updateData = {};
        if (category !== undefined) updateData.category = category;
        if (targetOfficerId !== undefined) updateData.Officer_id = targetOfficerId;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No fields provided for update"
            });
        }

        const { data, error } = await supabase
            .from("emergency_contacts")
            .update(updateData)
            .eq("id", id)
            .select(`
                id,
                category,
                Officer_id,
                Office_Staff_Details (
                    id,
                    Designation,
                    Location,
                    User_Details (
                        id,
                        "User Name",
                        email_id,
                        phone_number
                    )
                )
            `);

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error updating emergency contact"
            });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Emergency contact not found"
            });
        }

        // Clear cache
        try {
            await redis.del("emergency-contacts:all-contacts");
            await redis.del("emergency-contacts:stats");
        } catch (cacheErr) {
            console.error("Redis Del Cache Error:", cacheErr);
        }

        return res.status(200).json({
            success: true,
            message: "Emergency contact updated successfully",
            contact: data[0]
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

// =====================================
// 4. DELETE EMERGENCY CONTACT
// DELETE /api/emergency-contacts/:id
// =====================================
export const deleteEmergencyContact = async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from("emergency_contacts")
            .delete()
            .eq("id", id)
            .select();

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error deleting emergency contact"
            });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Emergency contact not found"
            });
        }

        // Clear cache
        try {
            await redis.del("emergency-contacts:all-contacts");
            await redis.del("emergency-contacts:stats");
        } catch (cacheErr) {
            console.error("Redis Del Cache Error:", cacheErr);
        }

        return res.status(200).json({
            success: true,
            message: "Emergency contact deleted successfully"
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

// =====================================
// 5. EMERGENCY CONTACT STATISTICS
// GET /api/emergency-contacts/stats
// =====================================
export const getEmergencyContactStats = async (req, res) => {
    try {
        const cacheKey = "emergency-contacts:stats";

        try {
            const cachedData = await redis.get(cacheKey);
            if (cachedData) {
                return res.status(200).json({
                    success: true,
                    source: "redis",
                    ...cachedData
                });
            }
        } catch (cacheErr) {
            console.error("Redis Cache Error:", cacheErr);
        }

        const { data, error } = await supabase
            .from("emergency_contacts")
            .select("category");

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error fetching emergency contact statistics"
            });
        }

        const total_contacts = data.length;
        const categories = {};

        data.forEach(item => {
            const cat = item.category || "Uncategorized";
            categories[cat] = (categories[cat] || 0) + 1;
        });

        const statsResult = {
            total_contacts,
            categories
        };

        try {
            await redis.set(cacheKey, statsResult, { ex: 3600 });
        } catch (cacheErr) {
            console.error("Redis Set Cache Error:", cacheErr);
        }

        return res.status(200).json({
            success: true,
            source: "supabase",
            ...statsResult
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};
