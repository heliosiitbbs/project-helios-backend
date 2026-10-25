import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";
import { findDatePlanForApp } from "./busAdminController.js";

// =====================================
// GET BUS SCHEDULE
// =====================================

export const getBusSchedule = async (req, res) => {
    try {
        const {
            day_of_week,
            date, // optional "YYYY-MM-DD": a one-off plan for that date replaces the regular schedule
            time,
            start_Location,
            end_Location
        } = req.body;

        const cacheKey = `bus-schedule:${day_of_week}`;

        let buses;
        let source = "supabase";
        let plan = null;

        const datePlan = date ? await findDatePlanForApp(date) : null;
        const cachedData = datePlan ? null : await redis.get(cacheKey);

        if (datePlan) {
            buses = datePlan.trips;
            plan = { date, note: datePlan.note };
            source = "date-plan";
        } else if (cachedData) {
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
            plan,
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

export const getExternalTransportContacts = async (req, res) => {
    try {
        const { type } = req.query; // 'ev' | 'auto' | omitted for all

        let query = supabase
            .from("external_transport")
            .select("*")
            .order("id", { ascending: true });

        if (type === "ev") {
            query = query.ilike("Transport_type", "EV Drive%");
        } else if (type === "auto") {
            query = query.ilike("Transport_type", "Auto%");
        }

        const { data, error } = await query;

        if (error) throw error;

        return res.status(200).json({
            success: true,
            contacts: data
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
