import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";

// =====================================
// GET ALL FOOD STALLS
// =====================================

export const getFoodStalls = async (req, res) => {
    try {
        const cacheKey = "food-stalls:all";

        const cachedData = await redis.get(cacheKey);

        if (cachedData) {
            return res.status(200).json({
                success: true,
                source: "redis",
                stalls: cachedData
            });
        }

        const { data, error } = await supabase
            .from("food_stall_details")
            .select("*");

        if (error) throw error;

        await redis.set(cacheKey, data, {
            ex: 3600
        });

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
