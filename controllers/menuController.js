import jwt from "jsonwebtoken";
import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";

export const getMenu = async (req, res) => {
    try {
        // Step 1: Get token from Authorization header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Access token missing"
            });
        }

        const token = authHeader.split(" ")[1];

        // Step 2: Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const hostelName = decoded.hostel;

        if (!hostelName) {
            return res.status(400).json({
                success: false,
                message: "Hostel details not found in token"
            });
        }

        // Step 3: Get today's day name
        const today = new Date().toLocaleDateString("en-US", {
            weekday: "long",
            timeZone: "Asia/Kolkata"
        });

        // Step 4: Create Redis cache key
        const cacheKey = `mess-menu:${hostelName}:${today}`;

        // Step 5: Check Redis first
        const cachedMenu = await redis.get(cacheKey);

        if (cachedMenu) {
            return res.json({
                success: true,
                source: "redis",
                ...cachedMenu
            });
        }

        // Step 6: Fetch today's mess menu from Supabase
        const { data: menuData, error: menuError } = await supabase
            .from("Mess_Menu")
            .select("type_of_meal, item_details")
            .eq("hostel_name", hostelName)
            .eq("day_of_the_week", today);

        if (menuError) throw menuError;

        // Step 7: Fetch compulsory menu from Supabase
        const { data: compulsoryData, error: compulsoryError } = await supabase
            .from("Mess_Menu_Compulsory")
            .select("type_of_meal, food_items")
            .eq("hostel_name", hostelName);

        if (compulsoryError) throw compulsoryError;

        // Step 8: Prepare final response format
        const meals = ["breakfast", "lunch", "dinner"];

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

        // Step 9: Create final response data
        const responseData = {
            hostel: hostelName,
            day: today,
            menu: finalMenu
        };

        // Step 10: Store in Redis with TTL of 1 hour
        await redis.set(cacheKey, responseData, {
            ex: 3600
        });

        // Step 11: Send response
        return res.json({
            success: true,
            source: "supabase",
            ...responseData
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
};

export const getFullWeekMenuByHostel = async (req, res) => {
    const { hostel_name } = req.body;

    try {
        // Step 1: Validate hostel input
        if (!hostel_name) {
            return res.status(400).json({
                success: false,
                message: "hostel_name is required"
            });
        }

        // Step 2: Fetch weekly mess menu for that hostel
        const { data: menuData, error: menuError } = await supabase
            .from("Mess_Menu")
            .select("type_of_meal, day_of_the_week, item_details")
            .eq("hostel_name", hostel_name);

        if (menuError) throw menuError;

        // Step 3: Fetch compulsory menu separately
        const { data: compulsoryData, error: compulsoryError } = await supabase
            .from("Mess_Menu_Compulsory")
            .select("type_of_meal, food_items")
            .eq("hostel_name", hostel_name);

        if (compulsoryError) throw compulsoryError;

        // Step 4: Define days and meals
        const days = [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday"
        ];

        const meals = ["breakfast", "lunch", "dinner"];

        // Step 5: Format compulsory separately
        const compulsory = meals.map((meal) => {
            const compulsoryMeal = compulsoryData.find(
                (item) => item.type_of_meal?.toLowerCase() === meal
            );

            return {
                Meal: meal.charAt(0).toUpperCase() + meal.slice(1),
                Food: compulsoryMeal ? compulsoryMeal.food_items : []
            };
        });

        // Step 6: Format daily menu separately
        const fullWeekMenu = days.map((day) => {
            return {
                Day: day,
                Meals: meals.map((meal) => {
                    const menuMeal = menuData.find(
                        (item) =>
                            item.day_of_the_week === day &&
                            item.type_of_meal?.toLowerCase() === meal
                    );

                    return {
                        Meal: meal.charAt(0).toUpperCase() + meal.slice(1),
                        Food: menuMeal ? menuMeal.item_details : []
                    };
                })
            };
        });

        // Step 7: Send response
        return res.json({
            success: true,
            hostel: hostel_name,
            compulsory,
            menu: fullWeekMenu
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
};