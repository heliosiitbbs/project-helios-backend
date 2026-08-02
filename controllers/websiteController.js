import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";

// =====================================
// 1. GET ALL WEBSITES
// GET /api/websites
// =====================================
export const getAllWebsites = async (req, res) => {
    try {
        const cacheKey = "redirect-websites:all-websites";

        try {
            const cachedData = await redis.get(cacheKey);
            if (cachedData) {
                return res.status(200).json({
                    success: true,
                    source: "redis",
                    websites: cachedData
                });
            }
        } catch (cacheErr) {
            console.error("Redis Cache Error:", cacheErr);
        }

        const { data, error } = await supabase
            .from("Redirecting_Websites")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error fetching websites"
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
            websites: data
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
// 2. CREATE WEBSITE
// POST /api/websites
// =====================================
export const createWebsite = async (req, res) => {
    try {
        const { website_name, website_link } = req.body;
        const description = req.body.description !== undefined ? req.body.description : req.body.Description;

        if (!website_name || !website_link) {
            return res.status(400).json({
                success: false,
                message: "website_name and website_link are required"
            });
        }

        const { data, error } = await supabase
            .from("Redirecting_Websites")
            .insert([
                {
                    website_name,
                    website_link,
                    Description: description
                }
            ])
            .select()
            .single();

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error creating website entry"
            });
        }

        // Clear cache
        try {
            await redis.del("redirect-websites:all-websites");
        } catch (cacheErr) {
            console.error("Redis Del Cache Error:", cacheErr);
        }

        return res.status(201).json({
            success: true,
            message: "Website created successfully",
            website: data
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
// 3. UPDATE WEBSITE
// PUT /api/websites/:id
// =====================================
export const updateWebsite = async (req, res) => {
    try {
        const { id } = req.params;
        const { website_name, website_link } = req.body;
        const description = req.body.description !== undefined ? req.body.description : req.body.Description;

        const updateData = {};
        if (website_name !== undefined) updateData.website_name = website_name;
        if (website_link !== undefined) updateData.website_link = website_link;
        if (description !== undefined) updateData.Description = description;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No fields provided for update"
            });
        }

        const { data, error } = await supabase
            .from("Redirecting_Websites")
            .update(updateData)
            .eq("id", id)
            .select();

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error updating website entry"
            });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Website not found"
            });
        }

        // Clear cache
        try {
            await redis.del("redirect-websites:all-websites");
        } catch (cacheErr) {
            console.error("Redis Del Cache Error:", cacheErr);
        }

        return res.status(200).json({
            success: true,
            message: "Website updated successfully",
            website: data[0]
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
// 4. DELETE WEBSITE
// DELETE /api/websites/:id
// =====================================
export const deleteWebsite = async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from("Redirecting_Websites")
            .delete()
            .eq("id", id)
            .select();

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error deleting website entry"
            });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Website not found"
            });
        }

        // Clear cache
        try {
            await redis.del("redirect-websites:all-websites");
        } catch (cacheErr) {
            console.error("Redis Del Cache Error:", cacheErr);
        }

        return res.status(200).json({
            success: true,
            message: "Website deleted successfully"
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};
