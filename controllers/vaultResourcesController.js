import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";

const clearVaultResourcesCache = async () => {
    try {
        await redis.del("vault-resources:all");
        await redis.del("vault-resources:stats");
        await redis.del("vault-resources:type:item");
        await redis.del("vault-resources:type:court");
    } catch (err) {
        console.error("Redis Cache Del Error:", err);
    }
};

// =====================================
// 1. GET ALL RESOURCES
// GET /api/vault-resources
// =====================================
export const getAllResources = async (req, res) => {
    try {
        const cacheKey = "vault-resources:all";

        try {
            const cachedData = await redis.get(cacheKey);
            if (cachedData) {
                return res.status(200).json({
                    success: true,
                    source: "redis",
                    resources: cachedData
                });
            }
        } catch (cacheErr) {
            console.error("Redis Cache Error:", cacheErr);
        }

        const { data, error } = await supabase
            .from("vault_resources")
            .select("*")
            .order("resource_id", { ascending: true });

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error fetching vault resources"
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
            resources: data
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
// 2. CREATE RESOURCE
// POST /api/vault-resources
// =====================================
export const createResource = async (req, res) => {
    try {
        const {
            resource_type,
            name,
            image_url,
            location,
            total_count,
            damaged_count,
            available_count,
            max_amount_per_request,
            allowed_time_to_keep_hours,
            min_users,
            slot_duration_minutes,
            max_time_per_reserve_hours
        } = req.body;

        if (!resource_type || !name) {
            return res.status(400).json({
                success: false,
                message: "resource_type and name are required"
            });
        }

        if (!["item", "court"].includes(resource_type.toLowerCase())) {
            return res.status(400).json({
                success: false,
                message: "resource_type must be 'item' or 'court'"
            });
        }

        const newResource = {
            resource_type: resource_type.toLowerCase(),
            name,
            image_url,
            location,
            total_count,
            damaged_count,
            available_count,
            max_amount_per_request,
            allowed_time_to_keep_hours,
            min_users,
            slot_duration_minutes,
            max_time_per_reserve_hours
        };

        const { data, error } = await supabase
            .from("vault_resources")
            .insert([newResource])
            .select()
            .single();

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error creating resource"
            });
        }

        await clearVaultResourcesCache();

        return res.status(201).json({
            success: true,
            message: "Resource created successfully",
            resource: data
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
// 3. UPDATE RESOURCE
// PUT /api/vault-resources/:resource_id
// =====================================
export const updateResource = async (req, res) => {
    try {
        const { resource_id } = req.params;
        const {
            resource_type,
            name,
            image_url,
            location,
            total_count,
            damaged_count,
            available_count,
            max_amount_per_request,
            allowed_time_to_keep_hours,
            min_users,
            slot_duration_minutes,
            max_time_per_reserve_hours
        } = req.body;

        const updateData = {};
        if (resource_type !== undefined) updateData.resource_type = resource_type;
        if (name !== undefined) updateData.name = name;
        if (image_url !== undefined) updateData.image_url = image_url;
        if (location !== undefined) updateData.location = location;
        if (total_count !== undefined) updateData.total_count = total_count;
        if (damaged_count !== undefined) updateData.damaged_count = damaged_count;
        if (available_count !== undefined) updateData.available_count = available_count;
        if (max_amount_per_request !== undefined) updateData.max_amount_per_request = max_amount_per_request;
        if (allowed_time_to_keep_hours !== undefined) updateData.allowed_time_to_keep_hours = allowed_time_to_keep_hours;
        if (min_users !== undefined) updateData.min_users = min_users;
        if (slot_duration_minutes !== undefined) updateData.slot_duration_minutes = slot_duration_minutes;
        if (max_time_per_reserve_hours !== undefined) updateData.max_time_per_reserve_hours = max_time_per_reserve_hours;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No fields provided for update"
            });
        }

        const { data, error } = await supabase
            .from("vault_resources")
            .update(updateData)
            .eq("resource_id", resource_id)
            .select();

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error updating resource"
            });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Resource not found"
            });
        }

        await clearVaultResourcesCache();

        return res.status(200).json({
            success: true,
            message: "Resource updated successfully",
            resource: data[0]
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
// 4. DELETE RESOURCE
// DELETE /api/vault-resources/:resource_id
// =====================================
export const deleteResource = async (req, res) => {
    try {
        const { resource_id } = req.params;

        const { data, error } = await supabase
            .from("vault_resources")
            .delete()
            .eq("resource_id", resource_id)
            .select();

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error deleting resource"
            });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Resource not found"
            });
        }

        await clearVaultResourcesCache();

        return res.status(200).json({
            success: true,
            message: "Resource deleted successfully"
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
// 5. GET RESOURCE STATISTICS
// GET /api/vault-resources/stats
// =====================================
export const getResourceStats = async (req, res) => {
    try {
        const cacheKey = "vault-resources:stats";

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
            .from("vault_resources")
            .select("resource_type, total_count, damaged_count, available_count");

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error fetching resource statistics"
            });
        }

        let total_resources = data.length;
        let total_items = 0;
        let total_courts = 0;
        let total_available_items = 0;
        let total_damaged_items = 0;

        data.forEach(resItem => {
            if (resItem.resource_type === "item") {
                total_items++;
                total_available_items += Number(resItem.available_count || 0);
                total_damaged_items += Number(resItem.damaged_count || 0);
            } else if (resItem.resource_type === "court") {
                total_courts++;
            }
        });

        const statsResult = {
            total_resources,
            total_items,
            total_courts,
            total_available_items,
            total_damaged_items
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
// 6. SEARCH RESOURCES
// GET /api/vault-resources/search?query=basketball
// =====================================
export const searchResources = async (req, res) => {
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
            .from("vault_resources")
            .select("*")
            .or(`name.ilike.${searchTerm},location.ilike.${searchTerm},resource_type.ilike.${searchTerm}`);

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error searching resources"
            });
        }

        return res.status(200).json({
            success: true,
            count: data.length,
            resources: data
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
// 7. GET RESOURCES BY TYPE
// GET /api/vault-resources/type/:resource_type
// =====================================
export const getResourcesByType = async (req, res) => {
    try {
        const { resource_type } = req.params;
        const normalizedType = resource_type.toLowerCase();

        if (!["item", "court"].includes(normalizedType)) {
            return res.status(400).json({
                success: false,
                message: "resource_type must be 'item' or 'court'"
            });
        }

        const cacheKey = `vault-resources:type:${normalizedType}`;

        try {
            const cachedData = await redis.get(cacheKey);
            if (cachedData) {
                return res.status(200).json({
                    success: true,
                    source: "redis",
                    resources: cachedData
                });
            }
        } catch (cacheErr) {
            console.error("Redis Cache Error:", cacheErr);
        }

        const { data, error } = await supabase
            .from("vault_resources")
            .select("*")
            .eq("resource_type", normalizedType)
            .order("name", { ascending: true });

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error fetching resources by type"
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
            resources: data
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
// 8. GET RESOURCE BY ID
// GET /api/vault-resources/:resource_id
// =====================================
export const getResourceById = async (req, res) => {
    try {
        const { resource_id } = req.params;

        const { data, error } = await supabase
            .from("vault_resources")
            .select("*")
            .eq("resource_id", resource_id)
            .single();

        if (error || !data) {
            return res.status(404).json({
                success: false,
                message: "Resource not found"
            });
        }

        return res.status(200).json({
            success: true,
            resource: data
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};
