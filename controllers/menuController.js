import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";

export const getMenu = async (req, res) => {
    try {
        const { day_of_the_week } = req.body;

        // Step 1: Validate day input
        if (!day_of_the_week) {
            return res.status(400).json({
                success: false,
                message: "day_of_the_week is required"
            });
        }

        // Step 2: Normalize day input
        const dayName =
            day_of_the_week.charAt(0).toUpperCase() +
            day_of_the_week.slice(1).toLowerCase();

        const validDays = [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday"
        ];

        if (!validDays.includes(dayName)) {
            return res.status(400).json({
                success: false,
                message: "Invalid day_of_the_week"
            });
        }

        // Step 3: Get hostel from the authenticated user's token
        const hostelName = req.user.hostel;

        if (!hostelName) {
            return res.status(400).json({
                success: false,
                message: "Hostel details not found in token"
            });
        }

        // Step 5: Create Redis cache key
        // (v2: entries cached before snacks were added only had 3 meals)
        const cacheKey = `mess-menu:v2:${hostelName}:${dayName}`;

        // Step 6: Check Redis first
        const cachedMenu = await redis.get(cacheKey);

        if (cachedMenu) {
            return res.json({
                success: true,
                source: "redis",
                ...cachedMenu
            });
        }

        // Step 7: Fetch selected day's mess menu from Supabase
        const { data: menuData, error: menuError } = await supabase
            .from("Mess_Menu")
            .select("type_of_meal, item_details")
            .eq("hostel_name", hostelName)
            .eq("day_of_the_week", dayName);

        if (menuError) throw menuError;

        // Step 8: Fetch compulsory menu from Supabase
        const { data: compulsoryData, error: compulsoryError } = await supabase
            .from("Mess_Menu_Compulsory")
            .select("type_of_meal, food_items")
            .eq("hostel_name", hostelName);

        if (compulsoryError) throw compulsoryError;

        // Step 9: Prepare final response format
        // Snacks only for hostels that serve them (RHR doesn't)
        const servesSnacks = [...menuData, ...compulsoryData].some((item) => item.type_of_meal?.toLowerCase() === "snacks");
        const meals = servesSnacks ? ["breakfast", "lunch", "snacks", "dinner"] : ["breakfast", "lunch", "dinner"];

        const finalMenu = meals.map((meal) => {
            const menuMeal = menuData.find(
                (item) => item.type_of_meal?.toLowerCase() === meal
            );

            const compulsoryMeal = compulsoryData.find(
                (item) => item.type_of_meal?.toLowerCase() === meal
            );

            return {
                Meal: meal.charAt(0).toUpperCase() + meal.slice(1),
                Food: {
                    Compulsory: compulsoryMeal ? compulsoryMeal.food_items : [],
                    Menu: menuMeal ? menuMeal.item_details : []
                }
            };
        });

        // Step 10: Create final response data
        const responseData = {
            hostel: hostelName,
            day: dayName,
            menu: finalMenu
        };

        // Step 11: Store in Redis with TTL of 1 hour
        await redis.set(cacheKey, responseData, {
            ex: 3600
        });

        // Step 12: Send response
        return res.json({
            success: true,
            source: "supabase",
            ...responseData
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error"});
    }
};
