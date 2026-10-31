import xlsx from "xlsx";
import supabase from "../config/Supabase.js";
import { sendPushToUsers, todayOnCampus } from "../utils/pushNotifications.js";
import { studentsTaking } from "./timetableAdminController.js";

// Exam timetables. The exam cell's sheet lists one row per course per room:
//   SLOT | DATE | TIME (24 H) | BUILDING | ROOM | COURSE CODE | COURSE NAME | STUDENT COUNT
// e.g. d1s1 | 23-Feb-2026 | 10:00-12:00 | Udayagiri HL | U13L | CS3L003 | Database Systems | 74
// The sheet's own dates are ignored: the admin picks the exam period and which days in
// it are exam days (Sundays and listed holidays are off by default), and day 1, 2, ...
// of the sheet land on those days in order. During the period the app shows students
// their exams and rooms instead of the weekly class timetable.

const MAX_ROWS = 5000;

const HEADER_ALIASES = {
    slot: ["slot", "slot id", "slot_id"],
    date: ["date", "exam date"],
    time: ["time (24 h)", "time (24h)", "time", "timing", "timings"],
    building: ["building", "block"],
    room: ["room", "room no", "room number", "venue"],
    code: ["course code", "course_code", "subject code", "subject_code", "code"],
    name: ["course name", "course_name", "subject name", "subject_name", "course", "subject"],
    count: ["student count", "total_students", "total students", "students", "count"],
};

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const serverError = (res, err) => {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
};

// ---------- dates (plain YYYY-MM-DD strings, no time zones involved) ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (date, n) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
const datesBetween = (start, end) => {
    const out = [];
    for (let d = start; d <= end && out.length < 400; d = addDays(d, 1)) out.push(d);
    return out;
};

const holidaysBetween = async (start, end) => {
    const { data, error } = await supabase
        .from("Holiday_List")
        .select("occasion, start_date, end_date")
        .lte("start_date", end)
        .gte("end_date", start);
    if (error) throw error;
    const byDate = new Map();
    (data || []).forEach((h) => {
        const from = h.start_date > start ? h.start_date : start;
        const last = h.end_date || h.start_date;
        datesBetween(from, last < end ? last : end).forEach((d) => byDate.set(d, h.occasion));
    });
    return byDate;
};

// ---------- reading the sheet ----------

const parseSlot = (value) => {
    const m = /^d(\d+)\s*s(\d+)$/i.exec(String(value || "").trim());
    return m ? { day: Number(m[1]), session: Number(m[2]) } : null;
};

const pad = (n) => String(n).padStart(2, "0");
const parseTimeRange = (value) => {
    const m = /^(\d{1,2})[:.](\d{2})\s*(?:-|–|—|to)\s*(\d{1,2})[:.](\d{2})$/i.exec(String(value || "").trim());
    if (!m) return null;
    const [h1, m1, h2, m2] = m.slice(1).map(Number);
    if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
    const start = `${pad(h1)}:${pad(m1)}`;
    const end = `${pad(h2)}:${pad(m2)}`;
    return start < end ? { start, end } : null;
};

const cellText = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").trim());

const readExamSheet = (buffer) => {
    const wb = xlsx.read(buffer, { type: "buffer", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const grid = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    for (let r = 0; r < Math.min(grid.length, 15); r++) {
        const cols = {};
        grid[r].forEach((cell, c) => {
            const label = String(cell).trim().toLowerCase();
            for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
                if (cols[key] === undefined && aliases.includes(label)) cols[key] = c;
            }
        });
        if (["slot", "time", "code"].every((k) => cols[k] !== undefined)) {
            const get = (cells, key) => (cols[key] === undefined ? "" : cellText(cells[cols[key]]));
            return grid
                .slice(r + 1)
                .map((cells, i) => ({
                    row: r + i + 2, // 1-based Excel row number
                    slot: get(cells, "slot"),
                    sheet_date: get(cells, "date"),
                    time: get(cells, "time"),
                    building: get(cells, "building"),
                    room: get(cells, "room"),
                    course_code: get(cells, "code").toUpperCase(),
                    course_name: get(cells, "name"),
                    student_count: get(cells, "count"),
                }))
                .filter((x) => x.slot || x.time || x.course_code);
        }
    }
    return null;
};

// Checks every row and groups them by exam day. Used by both preview and apply,
// so apply never trusts what the browser sends back.
const validateExamRows = (raw) => {
    const timesBySlot = new Map();
    const rows = raw.map((r) => {
        const out = {
            row: r.row,
            slot: String(r.slot || "").trim().toLowerCase(),
            sheet_date: String(r.sheet_date || "").trim(),
            building: String(r.building || "").trim(),
            room: String(r.room || "").trim(),
            course_code: String(r.course_code || "").trim().toUpperCase(),
            course_name: String(r.course_name || "").trim(),
            student_count: /^\d+$/.test(String(r.student_count ?? "").trim()) ? Number(r.student_count) : null,
            time: String(r.time || "").trim(),
            status: "ok",
            message: "",
        };
        const slot = parseSlot(out.slot);
        const time = parseTimeRange(out.time);
        const problems = [];
        if (!slot) problems.push(`slot "${r.slot}" should look like d1s1`);
        if (!time) problems.push(`time "${r.time}" should look like 10:00-12:00`);
        if (!out.course_code) problems.push("course code is missing");
        if (problems.length) {
            out.status = "error";
            out.message = problems.join("; ");
            return out;
        }
        Object.assign(out, { day: slot.day, session: slot.session, start: time.start, end: time.end });
        if (!out.room) {
            out.status = "warning";
            out.message = "no room given";
        }
        const key = out.slot;
        if (!timesBySlot.has(key)) timesBySlot.set(key, `${time.start}-${time.end}`);
        else if (timesBySlot.get(key) !== `${time.start}-${time.end}`) {
            out.status = "warning";
            out.message = `slot ${key} has a different time on another row (${timesBySlot.get(key)})`;
        }
        return out;
    });

    const valid = rows.filter((r) => r.status !== "error");
    const dayNumbers = [...new Set(valid.map((r) => r.day))].sort((a, b) => a - b);
    const days = dayNumbers.map((day) => {
        const dayRows = valid.filter((r) => r.day === day);
        const slots = [...new Set(dayRows.map((r) => r.slot))]
            .map((slot) => {
                const slotRows = dayRows.filter((r) => r.slot === slot);
                return { slot, start: slotRows[0].start, end: slotRows[0].end, courses: new Set(slotRows.map((r) => r.course_code)).size };
            })
            .sort((a, b) => a.start.localeCompare(b.start));
        return { day, sheet_date: dayRows.find((r) => r.sheet_date)?.sheet_date || "", slots };
    });

    return {
        rows,
        days,
        summary: {
            rows: rows.length,
            valid: valid.length,
            errors: rows.filter((r) => r.status === "error").length,
            warnings: rows.filter((r) => r.status === "warning").length,
            courses: new Set(valid.map((r) => r.course_code)).size,
            days: dayNumbers.length,
            slots: new Set(valid.map((r) => r.slot)).size,
        },
    };
};

const readPeriod = (body) => {
    const start = String(body.start_date || "").trim();
    const end = String(body.end_date || "").trim();
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) return { error: "Pick the first and last day of the exam period" };
    if (end < start) return { error: "The exam period must end on or after its first day" };
    if (datesBetween(start, end).length > 60) return { error: "The exam period can be at most 60 days" };
    return { start, end };
};

const overlappingSchedules = async (start, end) => {
    const { data, error } = await supabase
        .from("exam_schedules")
        .select("id, name, start_date, end_date")
        .lte("start_date", end)
        .gte("end_date", start);
    if (error) throw error;
    return data || [];
};

// ---------- admin endpoints (Time Table Admin / Super Admin) ----------

// POST /api/timetable/admin/exams/preview  (multipart: file, start_date, end_date)
// Nothing is saved. Returns the parsed rows, the sheet's exam days, and the suggested
// exam days in the period (every day except Sundays and listed holidays).
export const previewExamUpload = async (req, res) => {
    try {
        if (!req.file) return fail(res, 400, "Attach the exam timetable (.xlsx or .csv)");
        const period = readPeriod(req.body);
        if (period.error) return fail(res, 400, period.error);

        let raw;
        try {
            raw = readExamSheet(req.file.buffer);
        } catch {
            return fail(res, 400, "Couldn't read that file. Upload the exam timetable as .xlsx or .csv.");
        }
        if (!raw) return fail(res, 400, "Couldn't find the header row. The sheet needs at least SLOT, TIME and COURSE CODE columns (plus BUILDING and ROOM for seating).");
        if (raw.length === 0) return fail(res, 400, "The sheet has no exam rows");
        if (raw.length > MAX_ROWS) return fail(res, 400, `Too many rows (max ${MAX_ROWS})`);

        const result = validateExamRows(raw);
        const holidays = await holidaysBetween(period.start, period.end);
        const calendar = datesBetween(period.start, period.end).map((date) => ({
            date,
            weekday: weekday(date),
            holiday: holidays.get(date) || null,
        }));
        const suggested = calendar.filter((d) => d.weekday !== 0 && !d.holiday).map((d) => d.date);

        return res.status(200).json({
            success: true,
            fileName: req.file.originalname,
            start_date: period.start,
            end_date: period.end,
            calendar,
            suggested_exam_days: suggested,
            overlapping: await overlappingSchedules(period.start, period.end),
            ...result,
        });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /api/timetable/admin/exams/apply
// { name, start_date, end_date, exam_days: [dates], rows: [...from preview], replace, file_name }
export const applyExamUpload = async (req, res) => {
    try {
        const name = String(req.body.name || "").trim().slice(0, 120);
        if (!name) return fail(res, 400, "Give the exam timetable a name, e.g. Mid-semester exams, Autumn 2026");
        const period = readPeriod(req.body);
        if (period.error) return fail(res, 400, period.error);

        const input = Array.isArray(req.body.rows) ? req.body.rows : [];
        if (!input.length) return fail(res, 400, "No exam rows to save");
        if (input.length > MAX_ROWS) return fail(res, 400, `Too many rows (max ${MAX_ROWS})`);

        const { rows, days, summary } = validateExamRows(input);
        if (summary.errors) return fail(res, 400, `${summary.errors} row(s) still have errors. Fix the sheet and upload it again.`);

        const examDays = [...new Set((Array.isArray(req.body.exam_days) ? req.body.exam_days : []).map(String))]
            .filter((d) => DATE_RE.test(d) && d >= period.start && d <= period.end)
            .sort();
        if (examDays.length < days.length) {
            return fail(res, 400, `The sheet has ${days.length} exam days but only ${examDays.length} are selected in the period. Select more days or extend the period.`);
        }

        const overlapping = await overlappingSchedules(period.start, period.end);
        if (overlapping.length && !req.body.replace) {
            return fail(res, 409, `This period overlaps "${overlapping[0].name}" (${overlapping[0].start_date} to ${overlapping[0].end_date}). Confirm replacing it.`);
        }

        // Sheet day 1, 2, ... -> the 1st, 2nd, ... selected exam day
        const dateForDay = new Map(days.map((d, i) => [d.day, examDays[i]]));

        const { data: schedule, error: insertError } = await supabase
            .from("exam_schedules")
            .insert([{
                name,
                start_date: period.start,
                end_date: period.end,
                exam_days: examDays.slice(0, days.length),
                file_name: String(req.body.file_name || "").slice(0, 200) || null,
            }])
            .select("*")
            .single();
        if (insertError) throw insertError;

        const slotRows = rows
            .filter((r) => r.status !== "error")
            .map((r) => ({
                schedule_id: schedule.id,
                slot: r.slot,
                exam_date: dateForDay.get(r.day),
                start_time: r.start,
                end_time: r.end,
                course_code: r.course_code,
                course_name: r.course_name || null,
                building: r.building || null,
                room: r.room || null,
                student_count: r.student_count,
            }));
        for (let i = 0; i < slotRows.length; i += 1000) {
            const { error } = await supabase.from("exam_slots").insert(slotRows.slice(i, i + 1000));
            if (error) {
                // Don't leave half a timetable behind
                await supabase.from("exam_slots").delete().eq("schedule_id", schedule.id);
                await supabase.from("exam_schedules").delete().eq("id", schedule.id);
                throw error;
            }
        }

        for (const old of overlapping) {
            await supabase.from("exam_slots").delete().eq("schedule_id", old.id);
            await supabase.from("exam_schedules").delete().eq("id", old.id);
        }

        notifyExamTimetable(schedule, slotRows);

        return res.status(201).json({
            success: true,
            message: `Saved ${name}: ${summary.courses} courses over ${days.length} exam days.`,
            schedule,
        });
    } catch (err) {
        return serverError(res, err);
    }
};

// Tells each student taking one of the courses that their exam timetable is out
const notifyExamTimetable = (schedule, slotRows) => {
    const codes = [...new Set(slotRows.map((r) => r.course_code))];
    studentsTaking(codes)
        .then((byCode) => {
            const firstExam = new Map(); // userId -> earliest slot row
            slotRows.forEach((r) => {
                byCode.get(r.course_code)?.forEach((userId) => {
                    const current = firstExam.get(userId);
                    if (!current || `${r.exam_date} ${r.start_time}` < `${current.exam_date} ${current.start_time}`) firstExam.set(userId, r);
                });
            });
            const when = (r) =>
                new Date(`${r.exam_date}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
            return sendPushToUsers([...firstExam].map(([userId, r]) => ({
                userId,
                type: "timetable",
                title: `${schedule.name}: timetable is out`,
                body: `Your first exam is ${r.course_name || r.course_code} on ${when(r)} at ${r.start_time}. See your rooms in the timetable.`,
                data: { screen: "TimeTable" },
            })));
        })
        .catch((err) => console.error("Failed to send exam timetable push", err));
};

// GET /api/timetable/admin/exams - every exam timetable, newest period first
export const listExamSchedules = async (req, res) => {
    try {
        const { data: schedules, error } = await supabase
            .from("exam_schedules")
            .select("*")
            .order("start_date", { ascending: false });
        if (error) throw error;

        const counts = new Map();
        for (const s of schedules) {
            const { data: slots, error: slotError } = await supabase
                .from("exam_slots")
                .select("course_code")
                .eq("schedule_id", s.id)
                .range(0, 9999);
            if (slotError) throw slotError;
            counts.set(s.id, { rooms: slots.length, courses: new Set(slots.map((x) => x.course_code)).size });
        }

        const today = todayOnCampus();
        return res.status(200).json({
            success: true,
            schedules: schedules.map((s) => ({
                ...s,
                ...counts.get(s.id),
                status: s.end_date < today ? "ended" : s.start_date <= today ? "live" : "upcoming",
            })),
        });
    } catch (err) {
        return serverError(res, err);
    }
};

// GET /api/timetable/admin/exams/:id - one exam timetable with every room row
export const getExamSchedule = async (req, res) => {
    try {
        const { data: schedule, error } = await supabase.from("exam_schedules").select("*").eq("id", req.params.id).maybeSingle();
        if (error) throw error;
        if (!schedule) return fail(res, 404, "Exam timetable not found");

        const { data: slots, error: slotError } = await supabase
            .from("exam_slots")
            .select("*")
            .eq("schedule_id", schedule.id)
            .order("exam_date")
            .order("start_time")
            .order("course_code")
            .range(0, 9999);
        if (slotError) throw slotError;

        return res.status(200).json({
            success: true,
            schedule,
            slots: slots.map((s) => ({ ...s, start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5) })),
        });
    } catch (err) {
        return serverError(res, err);
    }
};

// DELETE /api/timetable/admin/exams/:id
export const deleteExamSchedule = async (req, res) => {
    try {
        const { error: slotError } = await supabase.from("exam_slots").delete().eq("schedule_id", req.params.id);
        if (slotError) throw slotError;
        const { data, error } = await supabase.from("exam_schedules").delete().eq("id", req.params.id).select("id");
        if (error) throw error;
        if (!data?.length) return fail(res, 404, "Exam timetable not found");
        return res.status(200).json({ success: true, message: "Exam timetable deleted" });
    } catch (err) {
        return serverError(res, err);
    }
};

// ---------- students ----------

// The exam period that's on now (or the next one coming up), plus this student's
// exams in it with their rooms. Used by GET /api/timetable/my-timetable so the app
// can swap the class timetable for exams during the period.
export const getMyExamInfo = async (subjectCodes) => {
    const today = todayOnCampus();
    const { data: schedules, error } = await supabase
        .from("exam_schedules")
        .select("id, name, start_date, end_date, exam_days")
        .gte("end_date", today)
        .order("start_date", { ascending: true })
        .limit(1);
    if (error) throw error;
    const schedule = schedules?.[0];
    if (!schedule) return { exam_period: null, exams: [] };

    let slots = [];
    if (subjectCodes.length) {
        const { data, error: slotError } = await supabase
            .from("exam_slots")
            .select("exam_date, start_time, end_time, course_code, course_name, building, room, student_count")
            .eq("schedule_id", schedule.id)
            .in("course_code", subjectCodes);
        if (slotError) throw slotError;
        slots = data || [];
    }

    // One entry per exam; a course split across rooms lists every room
    const byExam = new Map();
    slots.forEach((s) => {
        const start = s.start_time.slice(0, 5);
        const end = s.end_time.slice(0, 5);
        const key = `${s.course_code}|${s.exam_date}|${start}`;
        if (!byExam.has(key)) {
            byExam.set(key, { course_code: s.course_code, course_name: s.course_name || s.course_code, date: s.exam_date, start_time: start, end_time: end, rooms: [] });
        }
        if (s.room || s.building) byExam.get(key).rooms.push({ building: s.building || "", room: s.room || "", student_count: s.student_count });
    });

    const exams = [...byExam.values()].sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
    return {
        exam_period: { ...schedule, active: schedule.start_date <= today, today },
        exams,
    };
};
