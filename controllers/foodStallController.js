import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";

// Helper function to safely clear cache
const clearFoodStallsCache = async () => {
    try {
        await redis.del("food-stalls:all");
        await redis.del("food-stalls:stats");
    } catch (err) {
        console.error("Redis Cache Del Error:", err);
    }
};

// Uploads an optional multipart "photo" to the food_stall_images bucket and returns its public URL
const uploadStallPhoto = async (file) => {
    const fileExtension = file.originalname.split(".").pop();
    const filePath = `stalls/${Date.now()}.${fileExtension}`;

    const { error } = await supabase.storage
        .from("food_stall_images")
        .upload(filePath, file.buffer, { contentType: file.mimetype });

    if (error) throw error;

    const { data } = supabase.storage.from("food_stall_images").getPublicUrl(filePath);
    return data.publicUrl;
};

// =====================================
// 1. GET ALL FOOD STALLS
// GET /api/food-stalls
// =====================================
export const getFoodStalls = async (req, res) => {
    try {
        const cacheKey = "food-stalls:all";

        try {
            const cachedData = await redis.get(cacheKey);
            if (cachedData) {
                return res.status(200).json({
                    success: true,
                    source: "redis",
                    stalls: cachedData
                });
            }
        } catch (cacheErr) {
            console.error("Redis Cache Error:", cacheErr);
        }

        const { data, error } = await supabase
            .from("food_stall_details")
            .select("*")
            .order("id", { ascending: true });

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error fetching food stalls"
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
            stalls: data
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
// 2. CREATE FOOD STALL
// POST /api/food-stalls
// =====================================
export const createFoodStall = async (req, res) => {
    try {
        const stall_name = req.body.stall_name || req.body.name;
        const location = req.body.location !== undefined ? req.body.location : req.body.Location;
        const timings = req.body.timings !== undefined ? req.body.timings : (req.body.Timings || req.body.opening_hours);
        const phone_number = req.body.phone_number !== undefined ? req.body.phone_number : (req.body.phone || req.body.contact_number);
        const directions = req.body.directions !== undefined ? req.body.directions : req.body.Directions;
        let photo_url = req.body.photo_url !== undefined ? req.body.photo_url : (req.body.Photo_url || req.body.image || req.body.image_url);
        const type = req.body.type;

        if (req.file) {
            try {
                photo_url = await uploadStallPhoto(req.file);
            } catch (uploadError) {
                console.error(uploadError);
                return res.status(500).json({
                    success: false,
                    message: "Error uploading stall photo"
                });
            }
        }

        if (!stall_name) {
            return res.status(400).json({
                success: false,
                message: "stall_name is required"
            });
        }

        const insertData = {};
        if (stall_name !== undefined) insertData.stall_name = stall_name;
        if (location !== undefined) insertData.Location = location;
        if (timings !== undefined) insertData.Timings = timings;
        if (phone_number !== undefined) insertData.phone_number = phone_number;
        if (directions !== undefined) insertData.Directions = directions;
        if (photo_url !== undefined) insertData.Photo_url = photo_url;
        if (type !== undefined) insertData.type = type;

        const { data, error } = await supabase
            .from("food_stall_details")
            .insert([insertData])
            .select()
            .single();

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error creating food stall"
            });
        }

        await clearFoodStallsCache();

        return res.status(201).json({
            success: true,
            message: "Food stall created successfully",
            stall: data,
            data: data
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
// 3. UPDATE FOOD STALL
// PUT /api/food-stalls/:id
// =====================================
export const updateFoodStall = async (req, res) => {
    try {
        const { id } = req.params;
        const stall_name = req.body.stall_name || req.body.name;
        const location = req.body.location !== undefined ? req.body.location : req.body.Location;
        const timings = req.body.timings !== undefined ? req.body.timings : (req.body.Timings || req.body.opening_hours);
        const phone_number = req.body.phone_number !== undefined ? req.body.phone_number : (req.body.phone || req.body.contact_number);
        const directions = req.body.directions !== undefined ? req.body.directions : req.body.Directions;
        let photo_url = req.body.photo_url !== undefined ? req.body.photo_url : (req.body.Photo_url || req.body.image || req.body.image_url);
        const type = req.body.type;

        if (req.file) {
            try {
                photo_url = await uploadStallPhoto(req.file);
            } catch (uploadError) {
                console.error(uploadError);
                return res.status(500).json({
                    success: false,
                    message: "Error uploading stall photo"
                });
            }
        }

        const updateData = {};
        if (stall_name !== undefined) updateData.stall_name = stall_name;
        if (location !== undefined) updateData.Location = location;
        if (timings !== undefined) updateData.Timings = timings;
        if (phone_number !== undefined) updateData.phone_number = phone_number;
        if (directions !== undefined) updateData.Directions = directions;
        if (photo_url !== undefined) updateData.Photo_url = photo_url;
        if (type !== undefined) updateData.type = type;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No fields provided for update"
            });
        }

        const { data, error } = await supabase
            .from("food_stall_details")
            .update(updateData)
            .eq("id", id)
            .select();

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error updating food stall"
            });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Food stall not found"
            });
        }

        await clearFoodStallsCache();

        return res.status(200).json({
            success: true,
            message: "Food stall updated successfully",
            stall: data[0],
            data: data[0]
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
// 4. DELETE FOOD STALL
// DELETE /api/food-stalls/:id
// =====================================
export const deleteFoodStall = async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from("food_stall_details")
            .delete()
            .eq("id", id)
            .select();

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error deleting food stall"
            });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Food stall not found"
            });
        }

        await clearFoodStallsCache();

        return res.status(200).json({
            success: true,
            message: "Food stall deleted successfully"
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
// 5. GET FOOD STALL STATISTICS
// GET /api/food-stalls/stats
// =====================================
export const getFoodStallStats = async (req, res) => {
    try {
        const cacheKey = "food-stalls:stats";

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

        const { count, error } = await supabase
            .from("food_stall_details")
            .select("*", { count: "exact", head: true });

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error fetching food stall statistics"
            });
        }

        const statsResult = {
            total_stalls: count || 0
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

// =====================================
// 6. SEARCH FOOD STALLS
// GET /api/food-stalls/search?query=cafe
// =====================================
export const searchFoodStalls = async (req, res) => {
    try {
        const { query } = req.query;

        if (!query || query.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Search query parameter is required"
            });
        }

        const searchTerm = `%${query.trim()}%`;

        const { data, error } = await supabase
            .from("food_stall_details")
            .select("*")
            .or(`stall_name.ilike.${searchTerm},Location.ilike.${searchTerm},Directions.ilike.${searchTerm}`);

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error searching food stalls"
            });
        }

        return res.status(200).json({
            success: true,
            count: data.length,
            stalls: data
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
// 7. GET FOOD STALL BY ID
// GET /api/food-stalls/:id
// =====================================
export const getFoodStallById = async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from("food_stall_details")
            .select("*")
            .eq("id", id)
            .single();

        if (error || !data) {
            return res.status(404).json({
                success: false,
                message: "Food stall not found"
            });
        }

        return res.status(200).json({
            success: true,
            stall: data
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};
