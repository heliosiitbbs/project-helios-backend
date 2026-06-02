import jwt from "jsonwebtoken";
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

        // Step 3: Get token from Authorization header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Access token missing"
            });
        }

        const token = authHeader.split(" ")[1];

        // Step 4: Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const hostelName = decoded.hostel;

        if (!hostelName) {
            return res.status(400).json({
                success: false,
                message: "Hostel details not found in token"
            });
        }

        // Step 5: Create Redis cache key
        const cacheKey = `mess-menu:${hostelName}:${dayName}`;

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

export const editMessFoodItems = async (req, res) => {
    const {
        hostel_name,
        type_of_meal,
        food_items,
        day_of_the_week,
        is_compulsory
    } = req.body;

    try {
        // Step 1: Basic validation
        if (!hostel_name || !type_of_meal || !Array.isArray(food_items)) {
            return res.status(400).json({
                success: false,
                message: "hostel_name, type_of_meal and food_items array are required"
            });
        }

        // Step 2: If editing compulsory food items
        if (is_compulsory === true) {
            const { data, error } = await supabase
                .from("Mess_Menu_Compulsory")
                .update({
                    food_items: food_items
                })
                .eq("hostel_name", hostel_name)
                .eq("type_of_meal", type_of_meal.toLowerCase())
                .select();

            if (error) throw error;

            if (!data || data.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "No compulsory menu found for this hostel and meal"
                });
            }

            // Step 3: Since compulsory food affects every day,
            // delete all daily mess-menu cache keys for this hostel
            const days = [
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday"
            ];

            const cacheKeys = days.map(
                (day) => `mess-menu:${hostel_name}:${day}`
            );

            await Promise.all(cacheKeys.map((key) => redis.del(key)));

            return res.status(200).json({
                success: true,
                message: "Compulsory food items updated successfully",
                cacheDeleted: cacheKeys,
                updatedData: data[0]
            });
        }

        // Step 4: For normal daily menu, day_of_the_week is required
        if (!day_of_the_week) {
            return res.status(400).json({
                success: false,
                message: "day_of_the_week is required for editing daily menu"
            });
        }

        // Step 5: Update normal mess menu
        const { data, error } = await supabase
            .from("Mess_Menu")
            .update({
                item_details: food_items
            })
            .eq("hostel_name", hostel_name)
            .eq("day_of_the_week", day_of_the_week)
            .eq("type_of_meal", type_of_meal.toLowerCase())
            .select();

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No menu found for this hostel, day and meal"
            });
        }

        // Step 6: Delete Redis cache for that specific hostel and day
        const cacheKey = `mess-menu:${hostel_name}:${day_of_the_week}`;

        await redis.del(cacheKey);

        return res.status(200).json({
            success: true,
            message: "Food items updated successfully",
            cacheDeleted: cacheKey,
            updatedData: data[0]
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
};



export const uploadFullMessMenu = async (req, res) => {
    try {
        const {
            hostel_name,
            compulsory = [],
            menu = []
        } = req.body;

        // Step 1: Basic validation
        if (!hostel_name) {
            return res.status(400).json({
                success: false,
                message: "hostel_name is required"
            });
        }

        if (!Array.isArray(compulsory)) {
            return res.status(400).json({
                success: false,
                message: "compulsory must be an array"
            });
        }

        if (!Array.isArray(menu)) {
            return res.status(400).json({
                success: false,
                message: "menu must be an array"
            });
        }

        if (compulsory.length === 0 && menu.length === 0) {
            return res.status(400).json({
                success: false,
                message: "At least compulsory or menu data is required"
            });
        }

        const validDays = [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday"
        ];

        const normalizeMeal = (meal) => meal.trim().toLowerCase();

        const normalizeDay = (day) => {
            const formatted =
                day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();

            return formatted;
        };

        // Step 2: Validate compulsory data
        for (const item of compulsory) {
            if (
                !item.type_of_meal ||
                !Array.isArray(item.food_items)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Each compulsory item must contain type_of_meal and food_items array"
                });
            }
        }

        // Step 3: Validate daily menu data
        for (const item of menu) {
            if (
                !item.day_of_the_week ||
                !item.type_of_meal ||
                !Array.isArray(item.food_items)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Each menu item must contain day_of_the_week, type_of_meal and food_items array"
                });
            }

            const normalizedDay = normalizeDay(item.day_of_the_week);

            if (!validDays.includes(normalizedDay)) {
                return res.status(400).json({
                    success: false,
                    message: `${item.day_of_the_week} is not a valid day`
                });
            }
        }

        // Step 4: Check duplicate compulsory records inside request body
        const compulsoryKeys = new Set();

        for (const item of compulsory) {
            const key = `${hostel_name}:${normalizeMeal(item.type_of_meal)}`;

            if (compulsoryKeys.has(key)) {
                return res.status(400).json({
                    success: false,
                    message: "Duplicate compulsory item found in request body",
                    duplicate: {
                        hostel_name,
                        type_of_meal: item.type_of_meal
                    }
                });
            }

            compulsoryKeys.add(key);
        }

        // Step 5: Check duplicate daily menu records inside request body
        const menuKeys = new Set();

        for (const item of menu) {
            const day = normalizeDay(item.day_of_the_week);
            const meal = normalizeMeal(item.type_of_meal);

            const key = `${hostel_name}:${day}:${meal}`;

            if (menuKeys.has(key)) {
                return res.status(400).json({
                    success: false,
                    message: "Duplicate menu item found in request body",
                    duplicate: {
                        hostel_name,
                        day_of_the_week: day,
                        type_of_meal: meal
                    }
                });
            }

            menuKeys.add(key);
        }

        // Step 6: Fetch existing compulsory data from database
        const { data: existingCompulsory, error: compulsoryFetchError } =
            await supabase
                .from("Mess_Menu_Compulsory")
                .select("hostel_name, type_of_meal")
                .eq("hostel_name", hostel_name);

        if (compulsoryFetchError) throw compulsoryFetchError;

        // Step 7: Check if compulsory data already exists
        const existingCompulsorySet = new Set(
            existingCompulsory.map(
                (item) =>
                    `${item.hostel_name}:${item.type_of_meal.toLowerCase()}`
            )
        );

        const compulsoryDuplicates = compulsory.filter((item) => {
            const key = `${hostel_name}:${normalizeMeal(item.type_of_meal)}`;
            return existingCompulsorySet.has(key);
        });

        if (compulsoryDuplicates.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Some compulsory menu records already exist. Upload stopped.",
                duplicates: compulsoryDuplicates.map((item) => ({
                    hostel_name,
                    type_of_meal: normalizeMeal(item.type_of_meal)
                }))
            });
        }

        // Step 8: Fetch existing daily menu data from database
        const { data: existingMenu, error: menuFetchError } =
            await supabase
                .from("Mess_Menu")
                .select("hostel_name, day_of_the_week, type_of_meal")
                .eq("hostel_name", hostel_name);

        if (menuFetchError) throw menuFetchError;

        // Step 9: Check if daily menu already exists
        const existingMenuSet = new Set(
            existingMenu.map(
                (item) =>
                    `${item.hostel_name}:${item.day_of_the_week}:${item.type_of_meal.toLowerCase()}`
            )
        );

        const menuDuplicates = menu.filter((item) => {
            const day = normalizeDay(item.day_of_the_week);
            const meal = normalizeMeal(item.type_of_meal);

            const key = `${hostel_name}:${day}:${meal}`;

            return existingMenuSet.has(key);
        });

        if (menuDuplicates.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Some daily menu records already exist. Upload stopped.",
                duplicates: menuDuplicates.map((item) => ({
                    hostel_name,
                    day_of_the_week: normalizeDay(item.day_of_the_week),
                    type_of_meal: normalizeMeal(item.type_of_meal)
                }))
            });
        }

        // Step 10: Prepare compulsory rows for insert
        const compulsoryRows = compulsory.map((item) => ({
            hostel_name,
            type_of_meal: normalizeMeal(item.type_of_meal),
            food_items: item.food_items
        }));

        // Step 11: Prepare daily menu rows for insert
        const menuRows = menu.map((item) => ({
            hostel_name,
            day_of_the_week: normalizeDay(item.day_of_the_week),
            type_of_meal: normalizeMeal(item.type_of_meal),
            item_details: item.food_items
        }));

        let insertedCompulsory = [];
        let insertedMenu = [];

        // Step 12: Insert compulsory data
        if (compulsoryRows.length > 0) {
            const { data, error } = await supabase
                .from("Mess_Menu_Compulsory")
                .insert(compulsoryRows)
                .select();

            if (error) throw error;

            insertedCompulsory = data;
        }

        // Step 13: Insert daily menu data
        if (menuRows.length > 0) {
            const { data, error } = await supabase
                .from("Mess_Menu")
                .insert(menuRows)
                .select();

            if (error) throw error;

            insertedMenu = data;
        }

        // Step 14: Delete related Redis cache
        const affectedDays = new Set();

        for (const item of menuRows) {
            affectedDays.add(item.day_of_the_week);
        }

        // If compulsory items are inserted, they affect all days
        if (compulsoryRows.length > 0) {
            validDays.forEach((day) => affectedDays.add(day));
        }

        const cacheKeys = [...affectedDays].map(
            (day) => `mess-menu:${hostel_name}:${day}`
        );

        await Promise.all(cacheKeys.map((key) => redis.del(key)));

        return res.status(201).json({
            success: true,
            message: "Mess menu uploaded successfully",
            inserted: {
                compulsory: insertedCompulsory,
                menu: insertedMenu
            },
            cacheDeleted: cacheKeys
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
};