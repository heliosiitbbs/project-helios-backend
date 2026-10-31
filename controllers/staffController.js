import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";

// Hostel staff (caretakers, electricians...) have no User_Details account. They sign in
// with the phone number the hostel admin saved for them plus a temporary 6-digit PIN the
// admin set; on that first sign-in they must choose their own password before anything
// else works. They can only see - and add progress notes to - the grievances assigned to
// them. Resolving stays with the student.

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_SECONDS = 15 * 60;
const SESSION_TTL = "7d";

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const serverError = (res, err) => {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
};

export const normalizePhone = (value) =>
    String(value || "").replace(/[\s-]/g, "").replace(/^\+?91(?=\d{10}$)/, "");

const MIN_PASSWORD_LENGTH = 8;

// Changes whenever the PIN/password does, so resetting it signs the old sessions out
const pinVersion = (pinHash) => pinHash.slice(-10);

const sessionFor = (member) => ({
    token: jwt.sign(
        { purpose: "staff", staff_id: member.id, pv: pinVersion(member.pin_hash) },
        process.env.JWT_SECRET,
        { expiresIn: SESSION_TTL }
    ),
    userType: "Hostel Staff",
    must_change_password: !!member.must_change_password,
    staff: { name: member.name, role: member.role, hostel: member.hostel_name, phone: member.phone }
});

// POST /api/staff/login { phone, password } - password is the admin's temporary PIN
// until the staff member sets their own. (`pin` is still accepted from older clients.)
export const staffLogin = async (req, res) => {
    try {
        const phone = normalizePhone(req.body.phone);
        const password = String(req.body.password ?? req.body.pin ?? "");
        if (!/^\d{10}$/.test(phone) || !password || password.length > 128) {
            return fail(res, 400, "Enter your 10-digit phone number and password");
        }

        const failKey = `staff_login_fail:${phone}`;
        const failures = Number(await redis.get(failKey)) || 0;
        if (failures >= MAX_FAILED_LOGINS) {
            return fail(res, 429, "Too many wrong attempts. Try again in 15 minutes, or ask your hostel admin to reset your password.");
        }

        const { data: member, error } = await supabase
            .from("hostel_staff")
            .select("*")
            .eq("phone", phone)
            .maybeSingle();
        if (error) throw error;

        const ok = member && member.is_active && member.pin_hash && (await bcrypt.compare(password, member.pin_hash));
        if (!ok) {
            const count = await redis.incr(failKey);
            if (count === 1) await redis.expire(failKey, LOCKOUT_SECONDS);
            return fail(res, 401, "Wrong phone number or password");
        }

        await redis.del(failKey);
        return res.status(200).json({ success: true, ...sessionFor(member) });
    } catch (err) {
        return serverError(res, err);
    }
};

// Middleware: verifies a staff session token and attaches the staff row as req.staff.
// (The regular `protect` rejects these tokens because of their `purpose`.)
export const protectStaff = async (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer") ? header.split(" ")[1] : null;
    if (!token) return fail(res, 401, "Not authorized, no token");

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.purpose !== "staff") return fail(res, 401, "Not authorized");

        const { data: member, error } = await supabase
            .from("hostel_staff")
            .select("*")
            .eq("id", decoded.staff_id)
            .maybeSingle();
        if (error) throw error;

        if (!member || !member.is_active || !member.pin_hash || pinVersion(member.pin_hash) !== decoded.pv) {
            return fail(res, 401, "Your session has ended. Please sign in again.");
        }

        req.staff = member;
        next();
    } catch (err) {
        return fail(res, 401, "Token failed");
    }
};

// Middleware (after protectStaff): nothing but changing the password works while
// the staff member is still on the admin's temporary PIN
export const requirePasswordChanged = (req, res, next) => {
    if (req.staff.must_change_password) {
        return res.status(403).json({
            success: false,
            code: "MUST_CHANGE_PASSWORD",
            message: "Choose your own password before continuing."
        });
    }
    next();
};

// POST /api/staff/change-password { current_password, new_password }
// Returns a new session, since changing the password ends the old one.
export const changeStaffPassword = async (req, res) => {
    try {
        const current = String(req.body.current_password || "");
        const next = String(req.body.new_password || "");

        if (next.length < MIN_PASSWORD_LENGTH || next.length > 128) {
            return fail(res, 400, `Your new password needs at least ${MIN_PASSWORD_LENGTH} characters`);
        }
        if (/^\d+$/.test(next)) {
            return fail(res, 400, "Use letters as well as numbers");
        }
        if (!(await bcrypt.compare(current, req.staff.pin_hash))) {
            return fail(res, 401, "Your current password is wrong");
        }
        if (await bcrypt.compare(next, req.staff.pin_hash)) {
            return fail(res, 400, "Choose a password different from your current one");
        }

        const { data: member, error } = await supabase
            .from("hostel_staff")
            .update({ pin_hash: await bcrypt.hash(next, 10), must_change_password: false })
            .eq("id", req.staff.id)
            .select("*")
            .single();
        if (error) throw error;

        return res.status(200).json({ success: true, message: "Password changed.", ...sessionFor(member) });
    } catch (err) {
        return serverError(res, err);
    }
};

const GRIEVANCE_SELECT =
    '*, Student_Details!inner("Roll Number", "Room No", Hostel_Details, User_Details("User Name", display_name, phone_number))';

// GET /api/staff/grievances - everything assigned to me: open first, resolved ones for two weeks
export const getMyGrievances = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("Hostel_Grievances")
            .select(GRIEVANCE_SELECT)
            .eq("assigned_staff_id", req.staff.id)
            .order("created_at", { ascending: false });
        if (error) throw error;

        const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
        const visible = data.filter((g) => !g.is_resolved || new Date(g.resolved_at || g.created_at).getTime() >= cutoff);

        let updates = [];
        if (visible.length) {
            const { data: rows, error: updateError } = await supabase
                .from("grievance_updates")
                .select("id, grievance_id, staff_name, note, created_at")
                .in("grievance_id", visible.map((g) => g.id))
                .order("created_at", { ascending: false });
            if (updateError) throw updateError;
            updates = rows;
        }

        const grievances = visible
            .map((g) => {
                const { Student_Details: st } = g;
                const person = st?.User_Details || {};
                return {
                    id: g.id,
                    created_at: g.created_at,
                    assigned_at: g.assigned_at || null,
                    type: g["Grievance Type"] || "Others",
                    description: g.description,
                    proof: g.proof,
                    is_resolved: !!g.is_resolved,
                    resolved_at: g.resolved_at || null,
                    hostel: st?.Hostel_Details || "",
                    room: st?.["Room No"] || "",
                    student: {
                        name: person.display_name || person["User Name"] || g.student_id,
                        phone: person.phone_number || ""
                    },
                    updates: updates.filter((u) => u.grievance_id === g.id)
                };
            })
            .sort((a, b) => Number(a.is_resolved) - Number(b.is_resolved));

        return res.status(200).json({ success: true, grievances });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /api/staff/grievances/:id/updates { note } - a progress note the student sees ("needs 2 more days")
export const addGrievanceUpdate = async (req, res) => {
    try {
        const note = String(req.body.note || "").trim();
        if (!note) return fail(res, 400, "Write a note first");
        if (note.length > 300) return fail(res, 400, "Keep the note under 300 characters");

        const { data: grievance, error } = await supabase
            .from("Hostel_Grievances")
            .select("id, is_resolved")
            .eq("id", req.params.id)
            .eq("assigned_staff_id", req.staff.id)
            .maybeSingle();
        if (error) throw error;
        if (!grievance) return fail(res, 404, "That grievance isn't assigned to you");
        if (grievance.is_resolved) return fail(res, 400, "The student has already marked this resolved");

        const { data: update, error: insertError } = await supabase
            .from("grievance_updates")
            .insert([{ grievance_id: grievance.id, staff_id: req.staff.id, staff_name: req.staff.name, note }])
            .select("id, grievance_id, staff_name, note, created_at")
            .single();
        if (insertError) throw insertError;

        return res.status(201).json({ success: true, update });
    } catch (err) {
        return serverError(res, err);
    }
};
