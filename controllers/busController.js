import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";

// =====================================
// GET BUS SCHEDULE
// =====================================

export const getBusSchedule = async (req, res) => {
    try {
        const {
            day_of_week,
            time,
            start_Location,
            end_Location
        } = req.body;

        const cacheKey = `bus-schedule:${day_of_week}`;

        let buses;
        let source = "supabase";

        const cachedData = await redis.get(cacheKey);

        if (cachedData) {
            buses = cachedData;
            source = "redis";
        } else {
            const { data, error } = await supabase
                .from("Bus_Schedule")
                .select("*")
                .eq("day_of_week", day_of_week);

            if (error) throw error;

            buses = data;

            await redis.set(
                cacheKey,
                buses,
                {
                    ex: 3600
                }
            );
        }

        const filteredBuses = buses.filter((bus) => {
            const routeArray = bus.Route;

            if (start_Location || end_Location) {
                const startIdx = start_Location
                    ? routeArray.indexOf(start_Location)
                    : 0;

                const endIdx = end_Location
                    ? routeArray.indexOf(end_Location)
                    : routeArray.length - 1;

                if (
                    startIdx === -1 ||
                    endIdx === -1 ||
                    startIdx >= endIdx
                ) {
                    return false;
                }
            }

            if (time && bus.start_time) {
                return bus.start_time >= time;
            }

            return true;
        });

        return res.status(200).json({
            success: true,
            userType: req.user.user_type,
            source,
            buses: filteredBuses
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error"});
    }
};

// =====================================
// ADD BUS SCHEDULE (ADMIN ONLY)
// =====================================

export const addBusSchedule = async (req, res) => {
    try {
        const {
            bus_number,
            day_of_week,
            start_time,
            Route
        } = req.body;

        const { data, error } = await supabase
            .from("Bus_Schedule")
            .insert([
                {
                    bus_number,
                    day_of_week,
                    start_time,
                    Route
                }
            ])
            .select();

        if (error) throw error;

        await redis.del(
            `bus-schedule:${day_of_week}`
        );

        return res.status(201).json({
            success: true,
            message: "Bus schedule added successfully",
            data
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error"});
    }
};

// =====================================
// GET ALL SCHEDULES (ADMIN ONLY)
// =====================================

export const getAllBusSchedules = async (req, res) => {
    try {
        const cacheKey = "bus-schedule:all";

        const cachedData = await redis.get(cacheKey);

        if (cachedData) {
            return res.json({
                success: true,
                source: "redis",
                schedules: cachedData
            });
        }

        const { data, error } = await supabase
            .from("Bus_Schedule")
            .select("*");

        if (error) throw error;

        await redis.set(
            cacheKey,
            data,
            {
                ex: 3600
            }
        );

        return res.json({
            success: true,
            source: "supabase",
            schedules: data
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error"});
    }
};