import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";

// =====================================
// GET ALL WEBSITES
// =====================================

export const getAllWebsites = async (req, res) => {
    try {
        const cacheKey =
            "redirect-websites:all-websites";

        const cachedData =
            await redis.get(cacheKey);

        if (cachedData) {
            return res.status(200).json({
                success: true,
                source: "redis",
                websites: cachedData
            });
        }

        const { data, error } =
            await supabase
                .from("Redirecting_Websites")
                .select("*");

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
            websites: data
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error"});
    }
};

// =====================================
// GET SINGLE WEBSITE
// =====================================

export const getWebsiteByName = async (req, res) => {
    try {
        const { website_name } = req.params;

        const cacheKey =
            `redirect-website:${website_name}`;

        const cachedData =
            await redis.get(cacheKey);

        if (cachedData) {
            return res.status(200).json({
                success: true,
                source: "redis",
                website: cachedData
            });
        }

        const { data, error } =
            await supabase
                .from("Redirecting_Websites")
                .select("*")
                .eq(
                    "website_name",
                    website_name
                )
                .single();

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
            website: data
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error"});
    }
};

// =====================================
// ADD WEBSITE (ADMIN ONLY)
// =====================================

export const addWebsite = async (req, res) => {
    try {
        const {
            website_name,
            website_link,
            Description
        } = req.body;

        const { data, error } =
            await supabase
                .from("Redirecting_Websites")
                .insert([
                    {
                        website_name,
                        website_link,
                        Description
                    }
                ])
                .select();

        if (error) throw error;

        // Clear cache
        await redis.del(
            "redirect-websites:all-websites"
        );

        await redis.del(
            `redirect-website:${website_name}`
        );

        return res.status(201).json({
            success: true,
            message:
                "Website added successfully",
            data
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error"});
    }
};