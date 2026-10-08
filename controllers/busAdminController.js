import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";

// Transport Admin console.
//  - bus_fleet: the buses that may be scheduled
//  - Bus_Schedule: the regular weekly schedule, one row per trip per weekday.
//    Weekdays (Mon-Fri) share one plan and weekends (Sat-Sun) another; an edit
//    is written to every day in its scope. A trip within a day is identified by
//    bus number + departure time.
//  - bus_day_plans / bus_day_trips: a one-off schedule for a single date. When a
//    plan exists for a date the app shows it instead of the regular schedule;
//    the next day is unaffected.

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const JS_DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const serverError = (res, err) => {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
};

const toTime = (t) => {
    const m = String(t || "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    return `${m[1].padStart(2, "0")}:${m[2]}:00`;
};
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "") && !Number.isNaN(new Date(`${d}T00:00:00`).getTime());
const dayOfDate = (d) => JS_DAY[new Date(`${d}T00:00:00`).getDay()];
const sameRoute = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

const clearScheduleCache = async (days) => {
    try {
        await redis.del(...days.map((d) => `bus-schedule:${d}`), "bus-schedule:all");
    } catch (err) {
        console.error("Bus cache clear failed:", err.message);
    }
};

const activeFleet = async () => {
    const { data, error } = await supabase.from("bus_fleet").select("bus_number").eq("is_active", true);
    if (error) throw error;
    return new Set(data.map((b) => b.bus_number));
};

// Validates { bus_number, start_time, Route } against the active fleet
const readTrip = async (body) => {
    const bus = String(body.bus_number || "").trim().toUpperCase();
    const time = toTime(body.start_time);
    const route = Array.isArray(body.Route) ? body.Route.map((s) => String(s).trim()).filter(Boolean) : null;
    if (!bus) return { error: "Choose a bus" };
    if (!(await activeFleet()).has(bus)) return { error: `${bus} isn't in the bus list (or is inactive)` };
    if (!time) return { error: "Enter a valid departure time" };
    if (!route || route.length < 2) return { error: "A route needs at least two stops" };
    return { trip: { bus_number: bus, start_time: time, Route: route } };
};

const readDays = (days) => {
    const list = (Array.isArray(days) ? days : String(days || "").split(",")).map((d) => String(d).trim()).filter(Boolean);
    if (!list.length || list.some((d) => !DAYS.includes(d))) return null;
    return [...new Set(list)];
};

// ---------- Fleet ----------

export const getFleet = async (req, res) => {
    try {
        const { data, error } = await supabase.from("bus_fleet").select("*").order("bus_number");
        if (error) throw error;
        const { data: trips, error: e2 } = await supabase.from("Bus_Schedule").select("bus_number, day_of_week");
        if (e2) throw e2;
        const count = (bus, day) => trips.filter((t) => t.bus_number === bus && t.day_of_week === day).length;
        return res.status(200).json({
            success: true,
            buses: data.map((b) => ({ ...b, weekday_trips: count(b.bus_number, "Monday"), weekend_trips: count(b.bus_number, "Saturday") }))
        });
    } catch (err) {
        return serverError(res, err);
    }
};

export const addFleetBus = async (req, res) => {
    try {
        const bus = String(req.body.bus_number || "").trim().toUpperCase().replace(/\s+/g, "");
        if (!/^[A-Z0-9-]{1,12}$/.test(bus)) return fail(res, 400, "Use a short bus code like B9 or T3");
        const { data, error } = await supabase
            .from("bus_fleet")
            .insert([{ bus_number: bus, description: String(req.body.description || "").trim() || null }])
            .select()
            .single();
        if (error) {
            if (error.code === "23505") return fail(res, 409, `${bus} is already in the list`);
            throw error;
        }
        return res.status(201).json({ success: true, bus: { ...data, weekday_trips: 0, weekend_trips: 0 } });
    } catch (err) {
        return serverError(res, err);
    }
};

export const updateFleetBus = async (req, res) => {
    try {
        const patch = {};
        if (typeof req.body.is_active === "boolean") patch.is_active = req.body.is_active;
        if (req.body.description !== undefined) patch.description = String(req.body.description || "").trim() || null;
        const { data, error } = await supabase.from("bus_fleet").update(patch).eq("bus_number", req.params.bus).select().maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 404, "Bus not found");
        return res.status(200).json({ success: true, bus: data });
    } catch (err) {
        return serverError(res, err);
    }
};

export const deleteFleetBus = async (req, res) => {
    try {
        const bus = req.params.bus;
        const { count, error } = await supabase.from("Bus_Schedule").select("id", { count: "exact", head: true }).eq("bus_number", bus);
        if (error) throw error;
        if (count > 0) return fail(res, 409, `${bus} still runs ${count} scheduled trips. Remove or reassign them first, or mark the bus inactive.`);
        const { data, error: e2 } = await supabase.from("bus_fleet").delete().eq("bus_number", bus).select();
        if (e2) throw e2;
        if (!data.length) return fail(res, 404, "Bus not found");
        return res.status(200).json({ success: true });
    } catch (err) {
        return serverError(res, err);
    }
};

// ---------- Regular schedule (Bus_Schedule) ----------

// GET /admin/regular?days=Monday,Tuesday,...  -> union of trips across those days,
// each with the days it runs on (so drift between days is visible)
export const getRegularSchedule = async (req, res) => {
    try {
        const days = readDays(req.query.days);
        if (!days) return fail(res, 400, "Choose valid days");
        const { data, error } = await supabase.from("Bus_Schedule").select("*").in("day_of_week", days);
        if (error) throw error;
        const byKey = new Map();
        for (const r of data) {
            const key = `${r.bus_number}|${r.start_time}`;
            if (!byKey.has(key)) byKey.set(key, { bus_number: r.bus_number, start_time: r.start_time, variants: [] });
            const entry = byKey.get(key);
            let v = entry.variants.find((x) => sameRoute(x.Route, r.Route));
            if (!v) { v = { Route: r.Route, days: [] }; entry.variants.push(v); }
            v.days.push(r.day_of_week);
        }
        const trips = [...byKey.values()]
            .map((t) => {
                const main = [...t.variants].sort((a, b) => b.days.length - a.days.length)[0];
                const runsOn = t.variants.flatMap((v) => v.days);
                return {
                    bus_number: t.bus_number,
                    start_time: t.start_time,
                    Route: main.Route,
                    days: DAYS.filter((d) => runsOn.includes(d)),
                    // same route on every day in scope?
                    uniform: t.variants.length === 1 && runsOn.length === days.length
                };
            })
            .sort((a, b) => a.start_time.localeCompare(b.start_time) || a.bus_number.localeCompare(b.bus_number));
        return res.status(200).json({ success: true, days, trips });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /admin/regular  { days, trip }
export const addRegularTrip = async (req, res) => {
    try {
        const days = readDays(req.body.days);
        if (!days) return fail(res, 400, "Choose valid days");
        const { trip, error: invalid } = await readTrip(req.body.trip || {});
        if (invalid) return fail(res, 400, invalid);
        const { data: clash, error } = await supabase.from("Bus_Schedule").select("day_of_week")
            .eq("bus_number", trip.bus_number).eq("start_time", trip.start_time).in("day_of_week", days);
        if (error) throw error;
        if (clash.length) return fail(res, 409, `${trip.bus_number} already leaves at ${trip.start_time.slice(0, 5)} on ${clash.map((c) => c.day_of_week).join(", ")}`);
        const { error: e2 } = await supabase.from("Bus_Schedule").insert(days.map((d) => ({ ...trip, day_of_week: d })));
        if (e2) throw e2;
        await clearScheduleCache(days);
        return res.status(201).json({ success: true, message: `Added to ${days.length} day(s)` });
    } catch (err) {
        return serverError(res, err);
    }
};

// PUT /admin/regular  { days, match: { bus_number, start_time }, trip }
export const updateRegularTrip = async (req, res) => {
    try {
        const days = readDays(req.body.days);
        const match = req.body.match || {};
        const matchTime = toTime(match.start_time);
        if (!days || !match.bus_number || !matchTime) return fail(res, 400, "Missing days or the trip to change");
        const { trip, error: invalid } = await readTrip(req.body.trip || {});
        if (invalid) return fail(res, 400, invalid);

        const keyChanged = trip.bus_number !== match.bus_number || trip.start_time !== matchTime;
        if (keyChanged) {
            const { data: clash, error } = await supabase.from("Bus_Schedule").select("day_of_week")
                .eq("bus_number", trip.bus_number).eq("start_time", trip.start_time).in("day_of_week", days);
            if (error) throw error;
            if (clash.length) return fail(res, 409, `${trip.bus_number} already leaves at ${trip.start_time.slice(0, 5)} on ${clash.map((c) => c.day_of_week).join(", ")}`);
        }
        const { data, error } = await supabase.from("Bus_Schedule").update(trip)
            .eq("bus_number", match.bus_number).eq("start_time", matchTime).in("day_of_week", days).select("day_of_week");
        if (error) throw error;
        if (!data.length) return fail(res, 404, "That trip wasn't found on those days");
        await clearScheduleCache(days);
        return res.status(200).json({ success: true, message: `Updated on ${data.length} day(s)` });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /admin/regular/remove  { days, match }
export const removeRegularTrip = async (req, res) => {
    try {
        const days = readDays(req.body.days);
        const match = req.body.match || {};
        const matchTime = toTime(match.start_time);
        if (!days || !match.bus_number || !matchTime) return fail(res, 400, "Missing days or the trip to remove");
        const { data, error } = await supabase.from("Bus_Schedule").delete()
            .eq("bus_number", match.bus_number).eq("start_time", matchTime).in("day_of_week", days).select("day_of_week");
        if (error) throw error;
        await clearScheduleCache(days);
        return res.status(200).json({ success: true, message: `Removed from ${data.length} day(s)` });
    } catch (err) {
        return serverError(res, err);
    }
};

// ---------- One-off date plans ----------

const loadDatePlan = async (date) => {
    const { data: plan, error } = await supabase.from("bus_day_plans").select("*").eq("plan_date", date).maybeSingle();
    if (error) throw error;
    if (!plan) return null;
    const { data: trips, error: e2 } = await supabase.from("bus_day_trips").select("*").eq("plan_date", date).order("start_time").order("bus_number");
    if (e2) throw e2;
    return { plan, trips };
};

// Each date trip compared with the regular trip it came from
const describe = (trips, baseRows) => {
    const base = new Map(baseRows.map((b) => [b.id, b]));
    return trips.map((t) => {
        const b = t.base_id ? base.get(t.base_id) : null;
        const changes = [];
        if (!b) changes.push("added");
        else {
            if (b.bus_number !== t.bus_number) changes.push("bus");
            if (b.start_time !== t.start_time) changes.push("time");
            if (!sameRoute(b.Route, t.Route)) changes.push("route");
        }
        return { ...t, changes, original: b ? { bus_number: b.bus_number, start_time: b.start_time, Route: b.Route } : null };
    });
};

// GET /admin/dates?from=YYYY-MM-DD -> upcoming dates with changes
export const listDatePlans = async (req, res) => {
    try {
        const from = isDate(req.query.from) ? req.query.from : new Date().toISOString().slice(0, 10);
        const { data: plans, error } = await supabase.from("bus_day_plans").select("*").gte("plan_date", from).order("plan_date");
        if (error) throw error;
        const dates = plans.map((p) => p.plan_date);
        const { data: trips, error: e2 } = dates.length
            ? await supabase.from("bus_day_trips").select("plan_date, cancelled, base_id").in("plan_date", dates)
            : { data: [], error: null };
        if (e2) throw e2;
        return res.status(200).json({
            success: true,
            plans: plans.map((p) => {
                const mine = trips.filter((t) => t.plan_date === p.plan_date);
                return { ...p, day: dayOfDate(p.plan_date), trips: mine.length, cancelled: mine.filter((t) => t.cancelled).length, added: mine.filter((t) => !t.base_id).length };
            })
        });
    } catch (err) {
        return serverError(res, err);
    }
};

// GET /admin/dates/:date -> that date's plan, or the regular schedule it follows
export const getDatePlan = async (req, res) => {
    try {
        const date = req.params.date;
        if (!isDate(date)) return fail(res, 400, "Invalid date");
        const day = dayOfDate(date);
        const { data: baseRows, error } = await supabase.from("Bus_Schedule").select("*").eq("day_of_week", day).order("start_time");
        if (error) throw error;
        const found = await loadDatePlan(date);
        if (!found) {
            return res.status(200).json({ success: true, date, day, customized: false, trips: baseRows.map((b) => ({ ...b, cancelled: false, changes: [] })) });
        }
        return res.status(200).json({ success: true, date, day, customized: true, note: found.plan.note, trips: describe(found.trips, baseRows) });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /admin/dates/:date { note } -> start a one-off plan as a copy of that day's regular schedule
export const createDatePlan = async (req, res) => {
    try {
        const date = req.params.date;
        if (!isDate(date)) return fail(res, 400, "Invalid date");
        if (date < new Date(Date.now() - 86400000).toISOString().slice(0, 10)) return fail(res, 400, "That date has already passed");
        if (await loadDatePlan(date)) return fail(res, 409, "This date already has changes");
        const { data: baseRows, error } = await supabase.from("Bus_Schedule").select("*").eq("day_of_week", dayOfDate(date));
        if (error) throw error;
        const { error: e1 } = await supabase.from("bus_day_plans").insert([{ plan_date: date, note: String(req.body.note || "").trim() || null }]);
        if (e1) throw e1;
        if (baseRows.length) {
            const { error: e2 } = await supabase.from("bus_day_trips").insert(baseRows.map((b) => ({
                plan_date: date, bus_number: b.bus_number, start_time: b.start_time, Route: b.Route, cancelled: false, base_id: b.id
            })));
            if (e2) {
                await supabase.from("bus_day_plans").delete().eq("plan_date", date);
                throw e2;
            }
        }
        return res.status(201).json({ success: true });
    } catch (err) {
        return serverError(res, err);
    }
};

// PATCH /admin/dates/:date { note }
export const updateDatePlan = async (req, res) => {
    try {
        const { data, error } = await supabase.from("bus_day_plans")
            .update({ note: String(req.body.note || "").trim() || null }).eq("plan_date", req.params.date).select().maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 404, "No changes exist for this date");
        return res.status(200).json({ success: true, plan: data });
    } catch (err) {
        return serverError(res, err);
    }
};

// DELETE /admin/dates/:date -> back to the regular schedule
export const deleteDatePlan = async (req, res) => {
    try {
        const date = req.params.date;
        const { error: e1 } = await supabase.from("bus_day_trips").delete().eq("plan_date", date);
        if (e1) throw e1;
        const { data, error } = await supabase.from("bus_day_plans").delete().eq("plan_date", date).select();
        if (error) throw error;
        if (!data.length) return fail(res, 404, "No changes exist for this date");
        return res.status(200).json({ success: true });
    } catch (err) {
        return serverError(res, err);
    }
};

const planExists = async (date) => {
    const { data, error } = await supabase.from("bus_day_plans").select("plan_date").eq("plan_date", date).maybeSingle();
    if (error) throw error;
    return !!data;
};

// POST /admin/dates/:date/trips { trip }
export const addDateTrip = async (req, res) => {
    try {
        const date = req.params.date;
        if (!(await planExists(date))) return fail(res, 404, "Start changes for this date first");
        const { trip, error: invalid } = await readTrip(req.body.trip || {});
        if (invalid) return fail(res, 400, invalid);
        const { data: clash, error } = await supabase.from("bus_day_trips").select("id")
            .eq("plan_date", date).eq("bus_number", trip.bus_number).eq("start_time", trip.start_time).eq("cancelled", false);
        if (error) throw error;
        if (clash.length) return fail(res, 409, `${trip.bus_number} already leaves at ${trip.start_time.slice(0, 5)} that day`);
        const { data, error: e2 } = await supabase.from("bus_day_trips").insert([{ ...trip, plan_date: date, cancelled: false, base_id: null }]).select().single();
        if (e2) throw e2;
        return res.status(201).json({ success: true, trip: data });
    } catch (err) {
        return serverError(res, err);
    }
};

// PATCH /admin/dates/:date/trips/:id { trip?, cancelled? }
export const updateDateTrip = async (req, res) => {
    try {
        const { date, id } = req.params;
        const patch = {};
        if (typeof req.body.cancelled === "boolean") patch.cancelled = req.body.cancelled;
        if (req.body.trip) {
            const { trip, error: invalid } = await readTrip(req.body.trip);
            if (invalid) return fail(res, 400, invalid);
            const { data: clash, error } = await supabase.from("bus_day_trips").select("id")
                .eq("plan_date", date).eq("bus_number", trip.bus_number).eq("start_time", trip.start_time).eq("cancelled", false).neq("id", id);
            if (error) throw error;
            if (clash.length) return fail(res, 409, `${trip.bus_number} already leaves at ${trip.start_time.slice(0, 5)} that day`);
            Object.assign(patch, trip);
        }
        if (!Object.keys(patch).length) return fail(res, 400, "Nothing to change");
        const { data, error } = await supabase.from("bus_day_trips").update(patch).eq("plan_date", date).eq("id", id).select().maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 404, "Trip not found");
        return res.status(200).json({ success: true, trip: data });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /admin/dates/:date/cancel-bus { bus_number, cancelled } -> every trip of one bus that day
export const cancelBusForDate = async (req, res) => {
    try {
        const date = req.params.date;
        const bus = String(req.body.bus_number || "").trim().toUpperCase();
        const cancelled = req.body.cancelled !== false;
        if (!(await planExists(date))) return fail(res, 404, "Start changes for this date first");
        const { data, error } = await supabase.from("bus_day_trips").update({ cancelled }).eq("plan_date", date).eq("bus_number", bus).select("id");
        if (error) throw error;
        return res.status(200).json({ success: true, message: `${data.length} ${bus} trip(s) ${cancelled ? "cancelled" : "restored"}` });
    } catch (err) {
        return serverError(res, err);
    }
};

// DELETE /admin/dates/:date/trips/:id -> only for trips added that day (regular ones are cancelled instead)
export const deleteDateTrip = async (req, res) => {
    try {
        const { date, id } = req.params;
        const { data, error } = await supabase.from("bus_day_trips").delete().eq("plan_date", date).eq("id", id).is("base_id", null).select();
        if (error) throw error;
        if (!data.length) return fail(res, 400, "Only trips added for this date can be deleted; cancel regular trips instead");
        return res.status(200).json({ success: true });
    } catch (err) {
        return serverError(res, err);
    }
};

// Used by the app's getBusSchedule: the one-off plan for a date, if there is one
export const findDatePlanForApp = async (date) => {
    if (!isDate(date)) return null;
    const found = await loadDatePlan(date);
    return found ? { note: found.plan.note, trips: found.trips } : null;
};
