import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendPushToRollNumber } from "../utils/pushNotifications.js";
import { normalizePhone } from "./staffController.js";

// Hostel Admin console. Every endpoint is scoped to req.user.hostel (the
// User_Details.Hostel of the signed-in admin, attached by `protect`):
//  - grievances filed by students living in that hostel; the admin assigns them
//    to someone on the hostel's staff list (resolving is left to the student)
//  - hostel_staff: caretakers, electricians, plumbers... (no app accounts)
//  - the hostel's weekly mess menu (Mess_Menu + Mess_Menu_Compulsory)

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MEALS = ["breakfast", "lunch", "snacks", "dinner"];

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const serverError = (res, err) => {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
};

// Must run after protect + authorize("Hostel Admin")
export const requireHostel = (req, res, next) => {
    if (!req.user.hostel) return fail(res, 403, "No hostel is linked to this account. Ask the Super Admin to set it.");
    next();
};

// ---------- Grievances ----------

const GRIEVANCE_SELECT =
    '*, Student_Details!inner("Roll Number", "Room No", Hostel_Details, User_Details("User Name", display_name, phone_number))';

// Never send the PIN hash to the browser; only whether a PIN has been set
// hostel_staff.phone is unique across every hostel - staff sign in with it
const DUPLICATE_PHONE = "Another staff member (in this or another hostel) already uses this phone number";

const publicStaff = ({ pin_hash, ...member }) => ({ ...member, has_pin: !!pin_hash });

const loadStaff = async (ids) => {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return new Map();
    const { data, error } = await supabase.from("hostel_staff").select("*").in("id", list);
    if (error) throw error;
    return new Map(data.map((s) => [s.id, publicStaff(s)]));
};

const shapeGrievance = (g, staff) => {
    const { Student_Details: st, ...rest } = g;
    const person = st?.User_Details || {};
    return {
        id: rest.id,
        created_at: rest.created_at,
        type: rest["Grievance Type"] || "Others",
        description: rest.description,
        proof: rest.proof,
        is_resolved: !!rest.is_resolved,
        resolved_at: rest.resolved_at || null,
        assigned_at: rest.assigned_at || null,
        staff: rest.assigned_staff_id ? staff.get(rest.assigned_staff_id) || null : null,
        student: {
            roll_number: rest.student_id,
            name: person.display_name || person["User Name"] || rest.student_id,
            full_name: person["User Name"] || "",
            phone: person.phone_number || "",
            room: st?.["Room No"] || ""
        }
    };
};

// GET /api/hostel-admin/grievances
export const getHostelGrievances = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("Hostel_Grievances")
            .select(GRIEVANCE_SELECT)
            .eq("Student_Details.Hostel_Details", req.user.hostel)
            .order("created_at", { ascending: false });
        if (error) throw error;
        const staff = await loadStaff(data.map((g) => g.assigned_staff_id));
        return res.status(200).json({ success: true, hostel: req.user.hostel, grievances: data.map((g) => shapeGrievance(g, staff)) });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /api/hostel-admin/grievances/:id/assign { staff_id }
export const assignHostelGrievance = async (req, res) => {
    try {
        const staffId = Number(req.body.staff_id);
        if (!Number.isInteger(staffId)) return fail(res, 400, "Choose a staff member");

        const { data: grievance, error } = await supabase
            .from("Hostel_Grievances")
            .select(GRIEVANCE_SELECT)
            .eq("id", req.params.id)
            .eq("Student_Details.Hostel_Details", req.user.hostel)
            .maybeSingle();
        if (error) throw error;
        if (!grievance) return fail(res, 404, "Grievance not found in your hostel");
        if (grievance.is_resolved) return fail(res, 400, "This grievance is already resolved");

        const { data: member, error: e2 } = await supabase
            .from("hostel_staff")
            .select("*")
            .eq("id", staffId)
            .eq("hostel_name", req.user.hostel)
            .maybeSingle();
        if (e2) throw e2;
        if (!member) return fail(res, 404, "That staff member isn't on your hostel's list");
        if (!member.is_active) return fail(res, 400, `${member.name} is marked inactive`);

        const { data: updated, error: e3 } = await supabase
            .from("Hostel_Grievances")
            .update({ assigned_staff_id: member.id, assigned_at: new Date().toISOString() })
            .eq("id", grievance.id)
            .select(GRIEVANCE_SELECT)
            .single();
        if (e3) throw e3;

        if (grievance.assigned_staff_id !== member.id) {
            const type = grievance["Grievance Type"];
            sendPushToRollNumber(grievance.student_id, {
                type: "grievance",
                title: "Grievance assigned",
                body: `Your ${type ? `${type.toLowerCase()} ` : ""}grievance has been assigned to ${member.name} (${member.role})${member.phone ? `, ${member.phone}` : ""}.`,
                data: { screen: "GrievanceHome" }
            }).catch((err) => console.error("Failed to send grievance push", err));
        }

        return res.status(200).json({ success: true, grievance: shapeGrievance(updated, new Map([[member.id, publicStaff(member)]])) });
    } catch (err) {
        return serverError(res, err);
    }
};

// ---------- Staff ----------

const readStaffBody = (body, partial = false) => {
    const row = {};
    if (!partial || body.name !== undefined) {
        const name = String(body.name || "").trim();
        if (name.length < 2) return { error: "Enter the staff member's name" };
        row.name = name.slice(0, 80);
    }
    if (!partial || body.role !== undefined) {
        const role = String(body.role || "").trim();
        if (!role) return { error: "Enter a role, e.g. Electrician" };
        row.role = role.slice(0, 40);
    }
    if (!partial || body.phone !== undefined) {
        const phone = String(body.phone || "").replace(/[\s-]/g, "").replace(/^\+?91(?=\d{10}$)/, "");
        if (phone && !/^\d{10}$/.test(phone)) return { error: "Phone must be a 10-digit number" };
        row.phone = phone || null;
    }
    if (body.is_active !== undefined) row.is_active = body.is_active === true;
    return { row };
};

// Open grievances per staff member, so the list shows workload
const openCounts = async (hostel) => {
    const { data, error } = await supabase
        .from("Hostel_Grievances")
        .select("assigned_staff_id, Student_Details!inner(Hostel_Details)")
        .eq("Student_Details.Hostel_Details", hostel)
        .eq("is_resolved", false)
        .not("assigned_staff_id", "is", null);
    if (error) throw error;
    return data.reduce((m, g) => m.set(g.assigned_staff_id, (m.get(g.assigned_staff_id) || 0) + 1), new Map());
};

// GET /api/hostel-admin/staff
export const getHostelStaff = async (req, res) => {
    try {
        const { data, error } = await supabase.from("hostel_staff").select("*").eq("hostel_name", req.user.hostel).order("role").order("name");
        if (error) throw error;
        const counts = await openCounts(req.user.hostel);
        return res.status(200).json({ success: true, staff: data.map((s) => ({ ...publicStaff(s), open_grievances: counts.get(s.id) || 0 })) });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /api/hostel-admin/staff { name, role, phone }
export const addHostelStaff = async (req, res) => {
    try {
        const { row, error: invalid } = readStaffBody(req.body);
        if (invalid) return fail(res, 400, invalid);
        const { data, error } = await supabase.from("hostel_staff").insert([{ ...row, hostel_name: req.user.hostel }]).select().single();
        if (error) {
            if (error.code === "23505") return fail(res, 409, DUPLICATE_PHONE);
            throw error;
        }
        return res.status(201).json({ success: true, member: { ...publicStaff(data), open_grievances: 0 } });
    } catch (err) {
        return serverError(res, err);
    }
};

// PATCH /api/hostel-admin/staff/:id { name?, role?, phone?, is_active? }
export const updateHostelStaff = async (req, res) => {
    try {
        const { row, error: invalid } = readStaffBody(req.body, true);
        if (invalid) return fail(res, 400, invalid);
        if (!Object.keys(row).length) return fail(res, 400, "Nothing to update");
        const { data, error } = await supabase
            .from("hostel_staff")
            .update(row)
            .eq("id", req.params.id)
            .eq("hostel_name", req.user.hostel)
            .select()
            .maybeSingle();
        if (error) {
            if (error.code === "23505") return fail(res, 409, DUPLICATE_PHONE);
            throw error;
        }
        if (!data) return fail(res, 404, "Staff member not found");
        return res.status(200).json({ success: true, member: publicStaff(data) });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /api/hostel-admin/staff/:id/pin { pin? } - sets the staff member's 6-digit sign-in PIN
// (or resets it). Leave pin out to have one generated; a generated PIN is returned this once.
export const setStaffPin = async (req, res) => {
    try {
        const given = req.body.pin === undefined || req.body.pin === "" ? null : String(req.body.pin);
        if (given !== null && !/^\d{6}$/.test(given)) return fail(res, 400, "The PIN must be exactly 6 digits");

        const { data: member, error } = await supabase
            .from("hostel_staff")
            .select("id, name, phone")
            .eq("id", req.params.id)
            .eq("hostel_name", req.user.hostel)
            .maybeSingle();
        if (error) throw error;
        if (!member) return fail(res, 404, "Staff member not found");
        if (!normalizePhone(member.phone)) return fail(res, 400, `Add ${member.name}'s phone number first - they sign in with it`);

        const pin = given ?? String(crypto.randomInt(0, 1000000)).padStart(6, "0");
        const { error: updateError } = await supabase
            .from("hostel_staff")
            .update({ pin_hash: await bcrypt.hash(pin, 10) })
            .eq("id", member.id);
        if (updateError) {
            if (updateError.code === "23505") return fail(res, 409, DUPLICATE_PHONE);
            throw updateError;
        }

        return res.status(200).json({ success: true, ...(given === null ? { pin } : {}) });
    } catch (err) {
        return serverError(res, err);
    }
};

// DELETE /api/hostel-admin/staff/:id - only when nothing open is assigned to them
export const deleteHostelStaff = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const counts = await openCounts(req.user.hostel);
        if (counts.get(id)) {
            return fail(res, 400, `Still assigned to ${counts.get(id)} open grievance(s). Reassign them first, or mark this person inactive.`);
        }
        const { data, error } = await supabase.from("hostel_staff").delete().eq("id", id).eq("hostel_name", req.user.hostel).select();
        if (error) throw error;
        if (!data.length) return fail(res, 404, "Staff member not found");
        return res.status(200).json({ success: true });
    } catch (err) {
        return serverError(res, err);
    }
};

// ---------- Mess menu ----------

const cleanItems = (items) =>
    (Array.isArray(items) ? items : []).map((i) => String(i).trim()).filter(Boolean).slice(0, 40).map((i) => i.slice(0, 200));

// GET /api/hostel-admin/menu -> { meals, compulsory: { meal: [] }, days: { Day: { meal: [] } } }
export const getHostelMenu = async (req, res) => {
    try {
        const hostel = req.user.hostel;
        const [{ data: daily, error: e1 }, { data: comp, error: e2 }] = await Promise.all([
            supabase.from("Mess_Menu").select("day_of_the_week, type_of_meal, item_details").eq("hostel_name", hostel),
            supabase.from("Mess_Menu_Compulsory").select("type_of_meal, food_items").eq("hostel_name", hostel)
        ]);
        if (e1) throw e1;
        if (e2) throw e2;

        // Show the meals this hostel actually serves (RHR has no snacks), in the usual order
        const present = new Set([...daily, ...comp].map((r) => r.type_of_meal?.toLowerCase()));
        const meals = MEALS.filter((m) => present.has(m));
        const usedMeals = meals.length ? meals : ["breakfast", "lunch", "dinner"];

        const compulsory = Object.fromEntries(usedMeals.map((m) => [m, comp.find((r) => r.type_of_meal?.toLowerCase() === m)?.food_items || []]));
        const days = Object.fromEntries(DAYS.map((d) => [d, Object.fromEntries(usedMeals.map((m) => [
            m,
            daily.find((r) => r.day_of_the_week === d && r.type_of_meal?.toLowerCase() === m)?.item_details || []
        ]))]));
        return res.status(200).json({ success: true, hostel, meals: usedMeals, compulsory, days });
    } catch (err) {
        return serverError(res, err);
    }
};

// PUT /api/hostel-admin/menu { compulsory: { meal: [] }, days: { Day: { meal: [] } } }
// Saves the whole week in one go (the page edits a draft and saves once).
export const saveHostelMenu = async (req, res) => {
    try {
        const hostel = req.user.hostel;
        const { compulsory = {}, days = {} } = req.body || {};
        if (typeof compulsory !== "object" || typeof days !== "object") return fail(res, 400, "Invalid menu");

        const [{ data: daily, error: e1 }, { data: comp, error: e2 }] = await Promise.all([
            supabase.from("Mess_Menu").select("id, day_of_the_week, type_of_meal, item_details").eq("hostel_name", hostel),
            supabase.from("Mess_Menu_Compulsory").select("id, type_of_meal, food_items").eq("hostel_name", hostel)
        ]);
        if (e1) throw e1;
        if (e2) throw e2;

        const same = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
        const changedDays = new Set();
        let compulsoryChanged = false;

        for (const meal of MEALS) {
            if (!(meal in compulsory)) continue;
            const items = cleanItems(compulsory[meal]);
            const row = comp.find((r) => r.type_of_meal?.toLowerCase() === meal);
            if (row && same(row.food_items, items)) continue;
            if (!row && !items.length) continue;
            const { error } = row
                ? await supabase.from("Mess_Menu_Compulsory").update({ food_items: items }).eq("id", row.id)
                : await supabase.from("Mess_Menu_Compulsory").insert([{ hostel_name: hostel, type_of_meal: meal, food_items: items }]);
            if (error) throw error;
            compulsoryChanged = true;
        }

        for (const day of DAYS) {
            const meals = days[day];
            if (!meals || typeof meals !== "object") continue;
            for (const meal of MEALS) {
                if (!(meal in meals)) continue;
                const items = cleanItems(meals[meal]);
                const row = daily.find((r) => r.day_of_the_week === day && r.type_of_meal?.toLowerCase() === meal);
                if (row && same(row.item_details, items)) continue;
                if (!row && !items.length) continue;
                const { error } = row
                    ? await supabase.from("Mess_Menu").update({ item_details: items }).eq("id", row.id)
                    : await supabase.from("Mess_Menu").insert([{ hostel_name: hostel, day_of_the_week: day, type_of_meal: meal, item_details: items }]);
                if (error) throw error;
                changedDays.add(day);
            }
        }

        // The app caches each day's menu for an hour
        const stale = compulsoryChanged ? DAYS : [...changedDays];
        if (stale.length) {
            try {
                await redis.del(...stale.map((d) => `mess-menu:v2:${hostel}:${d}`));
            } catch (err) {
                console.error("Mess menu cache clear failed:", err.message);
            }
        }

        const changes = changedDays.size + (compulsoryChanged ? 1 : 0);
        return res.status(200).json({
            success: true,
            message: changes
                ? `Menu saved${compulsoryChanged ? " (daily items updated)" : ""}${changedDays.size ? ` — ${changedDays.size} day(s) changed` : ""}.`
                : "No changes to save."
        });
    } catch (err) {
        return serverError(res, err);
    }
};
