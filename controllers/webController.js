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

export const deleteWebsite = async (req, res) => {
    try {
        const { id } = req.params;

        const { error } = await supabase
            .from("Redirecting_Websites")
            .delete()
            .eq("id", id);

        if (error) throw error;

        // Clear cache
        await redis.del("redirect-websites:all-websites");

        return res.status(200).json({ success: true, message: "Website deleted successfully" });
    } catch (err) {
        console.error("DELETE WEBSITE ERROR:", err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// =====================================
// UPDATE WEBSITE (ADMIN ONLY)
// =====================================

export const updateWebsite = async (req, res) => {
    try {
        const { id } = req.params;
        const { website_name, website_link, Description } = req.body;

        const updateData = {};
        if (website_name !== undefined) updateData.website_name = website_name;
        if (website_link !== undefined) updateData.website_link = website_link;
        if (Description !== undefined) updateData.Description = Description;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ success: false, message: "No fields provided for update" });
        }

        // Fetch the old name so its single-website cache entry can be cleared too
        const { data: existing } = await supabase
            .from("Redirecting_Websites")
            .select("website_name")
            .eq("id", id)
            .maybeSingle();

        if (!existing) {
            return res.status(404).json({ success: false, message: "Website not found" });
        }

        const { data, error } = await supabase
            .from("Redirecting_Websites")
            .update(updateData)
            .eq("id", id)
            .select()
            .single();

        if (error) throw error;

        // Clear cache
        await redis.del("redirect-websites:all-websites");
        await redis.del(`redirect-website:${existing.website_name}`);
        await redis.del(`redirect-website:${data.website_name}`);

        return res.status(200).json({ success: true, message: "Website updated successfully", data });
    } catch (err) {
        console.error("UPDATE WEBSITE ERROR:", err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};
