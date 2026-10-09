import xlsx from "xlsx";
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




// ---------- Regular schedule via Excel ----------
// Sheet columns: Bus | Departure | Route ("RHR - ABB - AB - SIF"). Applying a file
// replaces every trip of the chosen plan (e.g. all weekdays) with the file's rows.

const EXCEL_HEADERS = ["Bus", "Departure", "Route"];
const HEADER_ALIASES = {
    bus: ["bus", "bus no", "bus number", "bus code", "bus_number"],
    time: ["departure", "time", "start", "start time", "departure time", "start_time"],
    route: ["route", "stops", "path"]
};

// Excel time fractions (0.3125), "7:30", "07:30:00", "7:30 PM"
const parseExcelTime = (v) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") {
        const mins = Math.round((v % 1) * 24 * 60);
        return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}:00`;
    }
    const m = String(v).trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*(am|pm)?$/);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2] || 0);
    if (m[3] === "pm" && h < 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;
};
// "RHR - ABB → AB, SIF" -> ["RHR","ABB","AB","SIF"]; a dash inside a name ("SECS-A-209") is kept
const splitRoute = (v) => String(v || "").split(/\s*(?:→|->|–|—|,|;|\n|\s-\s)\s*/).map((s) => s.trim()).filter(Boolean);

const readBusSheet = (buffer) => {
    const wb = xlsx.read(buffer, { type: "buffer" });
    const grid = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
    for (let r = 0; r < Math.min(grid.length, 15); r++) {
        const cols = {};
        grid[r].forEach((cell, c) => {
            const label = String(cell).trim().toLowerCase();
            for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
                if (cols[key] === undefined && aliases.includes(label)) cols[key] = c;
            }
        });
        if (cols.bus !== undefined && cols.time !== undefined && cols.route !== undefined) {
            return grid.slice(r + 1)
                .map((cells, i) => ({ row: r + i + 2, bus: cells[cols.bus], time: cells[cols.time], route: cells[cols.route] }))
                .filter((x) => String(x.bus).trim() || String(x.time).trim() || String(x.route).trim());
        }
    }
    return null;
};

const tripKey = (t) => `${t.bus_number}|${t.start_time}`;

// Validates uploaded rows and diffs them against the plan's current trips (first day of the plan)
const validateBusRows = async (rawRows, days) => {
    const fleet = await activeFleet();
    const seen = new Set();
    const rows = rawRows.map((r) => {
        const messages = [];
        let status = "ok";
        const bus = String(r.bus ?? r.bus_number ?? "").trim().toUpperCase().replace(/^BUS\s*(NO\.?)?\s*/, "");
        const time = typeof r.start_time === "string" && /^\d{2}:\d{2}:\d{2}$/.test(r.start_time) ? r.start_time : parseExcelTime(r.time ?? r.start_time);
        const route = Array.isArray(r.Route) ? r.Route : splitRoute(r.route);
        if (!bus) { status = "error"; messages.push("Missing bus"); }
        else if (!fleet.has(bus)) { status = "error"; messages.push(`${bus} isn't in the bus list (or is inactive)`); }
        if (!time) { status = "error"; messages.push(`Can't read departure time "${r.time ?? r.start_time ?? ""}"`); }
        if (route.length < 2) { status = "error"; messages.push("Route needs at least two stops"); }
        const out = { row: r.row, bus_number: bus, start_time: time || "", Route: route, status, messages };
        if (status === "ok") {
            if (seen.has(tripKey(out))) { out.status = "error"; out.messages = [`${bus} is listed twice at ${time.slice(0, 5)}`]; }
            seen.add(tripKey(out));
        }
        return out;
    });

    const { data: current, error } = await supabase.from("Bus_Schedule").select("bus_number, start_time, Route").eq("day_of_week", days[0]);
    if (error) throw error;
    const valid = rows.filter((r) => r.status === "ok");
    const before = new Map(current.map((t) => [tripKey(t), t]));
    const after = new Map(valid.map((t) => [tripKey(t), t]));
    const diff = {
        added: valid.filter((t) => !before.has(tripKey(t))).map(({ bus_number, start_time, Route }) => ({ bus_number, start_time, Route })),
        removed: current.filter((t) => !after.has(tripKey(t))),
        changed: valid.filter((t) => before.has(tripKey(t)) && !sameRoute(before.get(tripKey(t)).Route, t.Route))
            .map((t) => ({ bus_number: t.bus_number, start_time: t.start_time, Route: t.Route, oldRoute: before.get(tripKey(t)).Route })),
        unchanged: valid.filter((t) => before.has(tripKey(t)) && sameRoute(before.get(tripKey(t)).Route, t.Route)).length
    };
    return {
        rows,
        diff,
        summary: { rows: rows.length, valid: valid.length, errors: rows.length - valid.length, current: current.length, ...Object.fromEntries(["added", "removed", "changed"].map((k) => [k, diff[k].length])), unchanged: diff.unchanged }
    };
};

// Replacing a plan's rows gives every trip a new id. Upcoming date plans point at the old
// ids (base_id): re-point each at the new row with the same day + bus + time, or drop the
// link (it then shows as an extra trip of that date) if the file no longer has that trip.
const relinkDatePlans = async (oldRows, days) => {
    if (!oldRows.length) return;
    const today = new Date().toISOString().slice(0, 10);
    const { data: trips, error } = await supabase.from("bus_day_trips").select("id, base_id")
        .gte("plan_date", today).in("base_id", oldRows.map((r) => r.id));
    if (error) throw error;
    if (!trips.length) return;
    const { data: fresh, error: e2 } = await supabase.from("Bus_Schedule").select("id, day_of_week, bus_number, start_time").in("day_of_week", days);
    if (e2) throw e2;
    const key = (r) => `${r.day_of_week}|${r.bus_number}|${r.start_time}`;
    const oldById = new Map(oldRows.map((r) => [r.id, key(r)]));
    const newByKey = new Map(fresh.map((r) => [key(r), r.id]));
    for (const t of trips) {
        const { error: e3 } = await supabase.from("bus_day_trips").update({ base_id: newByKey.get(oldById.get(t.base_id)) ?? null }).eq("id", t.id);
        if (e3) throw e3;
    }
};

// GET /admin/regular/export?days=...  (same columns as the upload template)
export const exportRegularSchedule = async (req, res) => {
    try {
        const days = readDays(req.query.days);
        if (!days) return fail(res, 400, "Choose valid days");
        const { data, error } = await supabase.from("Bus_Schedule").select("bus_number, start_time, Route").eq("day_of_week", days[0]).order("start_time").order("bus_number");
        if (error) throw error;
        const sheet = xlsx.utils.aoa_to_sheet([EXCEL_HEADERS, ...data.map((t) => [t.bus_number, t.start_time.slice(0, 5), (t.Route || []).join(" - ")])]);
        sheet["!cols"] = [{ wch: 8 }, { wch: 11 }, { wch: 90 }];
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, sheet, "Buses");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", 'attachment; filename="bus-schedule.xlsx"');
        return res.send(xlsx.write(wb, { type: "buffer", bookType: "xlsx" }));
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /admin/regular/preview?days=...  (multipart "file") - writes nothing
export const previewRegularUpload = async (req, res) => {
    try {
        const days = readDays(req.query.days);
        if (!days) return fail(res, 400, "Choose valid days");
        if (!req.file) return fail(res, 400, "Attach an Excel or CSV file");
        let raw;
        try {
            raw = readBusSheet(req.file.buffer);
        } catch {
            return fail(res, 400, "Couldn't read that file. Upload the .xlsx template or a CSV.");
        }
        if (!raw) return fail(res, 400, `Couldn't find the header row. The first sheet needs columns: ${EXCEL_HEADERS.join(", ")}.`);
        if (!raw.length) return fail(res, 400, "The file has no trips");
        if (raw.length > 2000) return fail(res, 400, "Too many rows (max 2000)");
        return res.status(200).json({ success: true, days, fileName: req.file.originalname, ...(await validateBusRows(raw, days)) });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /admin/regular/apply { days, rows } - replaces the plan's trips with the rows
export const applyRegularUpload = async (req, res) => {
    try {
        const days = readDays(req.body.days);
        if (!days) return fail(res, 400, "Choose valid days");
        if (!Array.isArray(req.body.rows) || !req.body.rows.length) return fail(res, 400, "No trips to apply");
        const { rows, summary } = await validateBusRows(req.body.rows.map((r) => ({ row: r.row, bus_number: r.bus_number, start_time: r.start_time, Route: r.Route })), days);
        if (summary.errors) return fail(res, 400, `${summary.errors} row(s) still have errors. Fix the file and preview again.`);
        const trips = rows.map(({ bus_number, start_time, Route }) => ({ bus_number, start_time, Route }));
        const { data: oldRows, error: e0 } = await supabase.from("Bus_Schedule").select("id, day_of_week, bus_number, start_time").in("day_of_week", days);
        if (e0) throw e0;
        const { error: e1 } = await supabase.from("Bus_Schedule").delete().in("day_of_week", days);
        if (e1) throw e1;
        const inserts = days.flatMap((d) => trips.map((t) => ({ ...t, day_of_week: d })));
        for (let i = 0; i < inserts.length; i += 500) {
            const { error } = await supabase.from("Bus_Schedule").insert(inserts.slice(i, i + 500));
            if (error) throw error;
        }
        await clearScheduleCache(days);
        await relinkDatePlans(oldRows, days);
        return res.status(200).json({ success: true, message: `${trips.length} trips now run on ${days.length === 1 ? days[0] + "s" : days.map((d) => d.slice(0, 3)).join(", ")}` });
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
        // `regular` lets the editor reset its draft to the normal schedule without another request
        return res.status(200).json({ success: true, date, day, customized: true, note: found.plan.note, trips: describe(found.trips, baseRows), regular: baseRows });
    } catch (err) {
        return serverError(res, err);
    }
};





// PUT /admin/dates/:date/trips { note, trips: [{ bus_number, start_time, Route, cancelled, base_id }] }
// Saves the whole day at once (the admin edits a draft and saves it in one go).
// If the trips are exactly the regular schedule with nothing cancelled, the date goes
// back to the regular schedule instead of storing a copy.
export const saveDatePlan = async (req, res) => {
    try {
        const date = req.params.date;
        if (!isDate(date)) return fail(res, 400, "Invalid date");
        if (!Array.isArray(req.body.trips)) return fail(res, 400, "trips must be a list");
        const note = String(req.body.note || "").trim() || null;
        const fleet = await activeFleet();

        const trips = [];
        const seen = new Set();
        for (const [i, t] of req.body.trips.entries()) {
            const bus = String(t.bus_number || "").trim().toUpperCase();
            const time = toTime(t.start_time);
            const route = Array.isArray(t.Route) ? t.Route.map((s) => String(s).trim()).filter(Boolean) : [];
            const cancelled = t.cancelled === true;
            const label = `Trip ${i + 1} (${bus || "no bus"} ${time ? time.slice(0, 5) : "?"})`;
            if (!time) return fail(res, 400, `${label}: invalid time`);
            if (route.length < 2) return fail(res, 400, `${label}: a route needs at least two stops`);
            if (!cancelled && !fleet.has(bus)) return fail(res, 400, `${label}: ${bus} isn't in the active bus list`);
            if (!cancelled) {
                if (seen.has(`${bus}|${time}`)) return fail(res, 400, `${bus} leaves twice at ${time.slice(0, 5)}`);
                seen.add(`${bus}|${time}`);
            }
            trips.push({ plan_date: date, bus_number: bus, start_time: time, Route: route, cancelled, base_id: Number.isInteger(t.base_id) ? t.base_id : null });
        }

        const { data: base, error } = await supabase.from("Bus_Schedule").select("id, bus_number, start_time, Route").eq("day_of_week", dayOfDate(date));
        if (error) throw error;
        const baseById = new Map(base.map((b) => [b.id, b]));
        const isRegular = trips.length === base.length && trips.every((t) => {
            const b = t.base_id && baseById.get(t.base_id);
            return b && !t.cancelled && b.bus_number === t.bus_number && b.start_time === t.start_time && sameRoute(b.Route, t.Route);
        }) && new Set(trips.map((t) => t.base_id)).size === base.length;

        const { error: e1 } = await supabase.from("bus_day_trips").delete().eq("plan_date", date);
        if (e1) throw e1;
        if (isRegular) {
            const { error: e2 } = await supabase.from("bus_day_plans").delete().eq("plan_date", date);
            if (e2) throw e2;
            return res.status(200).json({ success: true, customized: false, message: "No differences from the regular schedule — this date follows it again." });
        }

        const { error: e3 } = await supabase.from("bus_day_plans").upsert([{ plan_date: date, note }], { onConflict: "plan_date" });
        if (e3) throw e3;
        for (let i = 0; i < trips.length; i += 500) {
            const { error: e4 } = await supabase.from("bus_day_trips").insert(trips.slice(i, i + 500));
            if (e4) throw e4;
        }
        return res.status(200).json({ success: true, customized: true, message: `Saved ${trips.filter((t) => !t.cancelled).length} running trips for this day.` });
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
