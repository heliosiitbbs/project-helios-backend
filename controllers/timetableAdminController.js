import xlsx from "xlsx";
import supabase from "../config/Supabase.js";
import { sendPushToUsers } from "../utils/pushNotifications.js";

// Timetable editing for the Time Table Admin console (Subject_Timings).
// Excel uploads are two-step: /preview parses + validates + diffs without
// writing anything, /apply re-validates the same rows and replaces the
// timings of every subject present in the file (other subjects untouched).

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TEMPLATE_HEADERS = ["Subject code", "Subject name", "Day", "Start", "End", "Room"];

// ---------- helpers ----------

const pageAll = async (build) => {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
};

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const fromMinutes = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
// "08:00:00+00" -> "08:00"
const dbTime = (t) => (t || "").slice(0, 5);

const normalizeDay = (v) => {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;
  return DAYS.find((d) => d.toLowerCase() === s || d.toLowerCase().slice(0, 3) === s.slice(0, 3)) || null;
};

// Accepts Excel time fractions (0.375), "8:00", "08:00:00", "8:00 AM", "1:30pm", "13.30"
const parseTime = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const frac = v >= 1 ? v % 1 : v;
    return Math.round(frac * 24 * 60);
  }
  const m = String(v).trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};
const roundHalfHour = (n) => Math.round(n / 30) * 30;

const HEADER_ALIASES = {
  code: ["subject code", "course code", "code", "subject_code"],
  name: ["subject name", "course name", "name", "subject", "course"],
  day: ["day", "day of the week", "weekday"],
  start: ["start", "start time", "from", "starts"],
  end: ["end", "end time", "to", "ends"],
  room: ["room", "location", "venue", "room no", "classroom"]
};

// Finds the header row (first row naming at least code, day, start and end) and maps the columns
const readSheet = (buffer) => {
  const wb = xlsx.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const cols = {};
    grid[r].forEach((cell, c) => {
      const label = String(cell).trim().toLowerCase();
      for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
        if (cols[key] === undefined && aliases.includes(label)) cols[key] = c;
      }
    });
    if (["code", "day", "start", "end"].every((k) => cols[k] !== undefined)) {
      return grid.slice(r + 1)
        .map((cells, i) => ({
          row: r + i + 2, // 1-based Excel row number
          subject_code: String(cells[cols.code] ?? "").trim().toUpperCase(),
          subject_name: cols.name !== undefined ? String(cells[cols.name] ?? "").trim() : "",
          day: cells[cols.day],
          start: cells[cols.start],
          end: cells[cols.end],
          location: cols.room !== undefined ? String(cells[cols.room] ?? "").trim() : ""
        }))
        .filter((r2) => r2.subject_code || r2.day || r2.start || r2.end);
    }
  }
  return null;
};

const fetchSubjects = async (codes) => {
  const map = new Map();
  for (let i = 0; i < codes.length; i += 300) {
    const { data, error } = await supabase
      .from("Subject_Details")
      .select('subject_code, subject_name, Teacher_Details(User_Details("User Name"))')
      .in("subject_code", codes.slice(i, i + 300));
    if (error) throw error;
    data.forEach((s) => map.set(s.subject_code, {
      name: s.subject_name,
      teacher: s.Teacher_Details?.User_Details?.["User Name"] || null
    }));
  }
  return map;
};

const shapeTiming = (t, subjects) => ({
  id: t.id,
  subject_code: t.subject_code,
  subject_name: subjects.get(t.subject_code)?.name || t.subject_code,
  teacher: subjects.get(t.subject_code)?.teacher || null,
  day: t.day_of_the_week,
  start: dbTime(t.start_time),
  end: dbTime(t.end_time),
  location: t.Location || ""
});

const overlaps = (a, b) => a.day === b.day && toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);

// Validates raw rows (from Excel or from a previewed upload). Returns normalized rows with
// status/messages, a per-subject before/after diff and room clashes.
const validateRows = async (rawRows) => {
  const codes = [...new Set(rawRows.map((r) => r.subject_code).filter(Boolean))];
  const subjects = await fetchSubjects(codes);
  const existing = await pageAll(() => supabase.from("Subject_Timings").select("*").order("id"));

  const seen = new Set();
  const rows = rawRows.map((r) => {
    const messages = [];
    let status = "ok";
    const fail = (m) => { status = "error"; messages.push(m); };
    const warn = (m) => { if (status === "ok") status = "warning"; messages.push(m); };

    const code = String(r.subject_code || "").trim().toUpperCase();
    const known = subjects.get(code);
    const name = (r.subject_name || "").trim();
    if (!code) fail("Missing subject code");
    else if (!known && !name) fail(`Unknown subject code ${code} (add a subject name to create it)`);
    else if (!known) warn(`New subject — will be created as "${name}"`);

    const day = normalizeDay(r.day);
    if (!day) fail(`Can't read day "${r.day ?? ""}"`);

    let start = typeof r.start === "string" && /^\d{2}:\d{2}$/.test(r.start) ? toMinutes(r.start) : parseTime(r.start);
    let end = typeof r.end === "string" && /^\d{2}:\d{2}$/.test(r.end) ? toMinutes(r.end) : parseTime(r.end);
    if (start === null) fail(`Can't read start time "${r.start ?? ""}"`);
    if (end === null) fail(`Can't read end time "${r.end ?? ""}"`);
    if (start !== null && end !== null) {
      const rs = roundHalfHour(start);
      const re = roundHalfHour(end);
      if (rs !== start || re !== end) warn(`Rounded ${fromMinutes(start)}–${fromMinutes(end)} to ${fromMinutes(rs)}–${fromMinutes(re)}`);
      start = rs;
      end = re;
      if (end <= start) fail("End time must be after start time");
      else if (start < 7 * 60 || end > 21 * 60) warn("Outside 07:00–21:00");
    }

    const out = {
      row: r.row,
      subject_code: code,
      // Never fall back to the code here: /apply re-validates these rows, and a
      // name would turn an unknown code into a "create this subject" row
      subject_name: known?.name || name,
      teacher: known?.teacher || null,
      is_new_subject: !known && !!name,
      day,
      start: start !== null ? fromMinutes(start) : "",
      end: end !== null ? fromMinutes(end) : "",
      location: (r.location || "").trim(),
      status,
      messages
    };
    if (status !== "error") {
      const key = [code, day, out.start, out.end, out.location.toLowerCase()].join("|");
      if (seen.has(key)) { out.status = "skipped"; out.messages = ["Duplicate of an earlier row"]; }
      seen.add(key);
    }
    return out;
  });

  const valid = rows.filter((r) => r.status === "ok" || r.status === "warning");
  const fileCodes = new Set(valid.map((r) => r.subject_code));

  // Room clashes among the new rows, and against timings of subjects not in the file
  const kept = existing.filter((t) => !fileCodes.has(t.subject_code)).map((t) => ({
    subject_code: t.subject_code, day: t.day_of_the_week, start: dbTime(t.start_time), end: dbTime(t.end_time), location: t.Location || ""
  }));
  const clashes = [];
  valid.forEach((a, i) => {
    if (!a.location) return;
    const room = a.location.toLowerCase();
    valid.slice(i + 1).forEach((b) => {
      if (b.location.toLowerCase() === room && b.subject_code !== a.subject_code && overlaps(a, b)) {
        clashes.push({ day: a.day, room: a.location, a: `${a.subject_code} ${a.start}–${a.end}`, b: `${b.subject_code} ${b.start}–${b.end}` });
      }
    });
    kept.forEach((b) => {
      if (b.location.toLowerCase() === room && overlaps(a, b)) {
        clashes.push({ day: a.day, room: a.location, a: `${a.subject_code} ${a.start}–${a.end}`, b: `${b.subject_code} ${b.start}–${b.end} (not in file)` });
      }
    });
  });

  // Per-subject diff: what each subject's timings look like before vs after
  const slotKey = (s) => `${s.day}|${s.start}|${s.end}|${(s.location || "").toLowerCase()}`;
  const diff = [...fileCodes].map((code) => {
    const before = existing.filter((t) => t.subject_code === code).map((t) => ({
      day: t.day_of_the_week, start: dbTime(t.start_time), end: dbTime(t.end_time), location: t.Location || ""
    }));
    const after = valid.filter((r) => r.subject_code === code).map(({ day, start, end, location }) => ({ day, start, end, location }));
    const beforeKeys = new Set(before.map(slotKey));
    const afterKeys = new Set(after.map(slotKey));
    const added = after.filter((s) => !beforeKeys.has(slotKey(s))).length;
    const removed = before.filter((s) => !afterKeys.has(slotKey(s))).length;
    return {
      subject_code: code,
      subject_name: valid.find((r) => r.subject_code === code).subject_name || code,
      before,
      after,
      added,
      removed,
      change: added || removed ? (before.length ? "changed" : "new") : "unchanged"
    };
  });

  const summary = {
    rows: rows.length,
    valid: valid.length,
    errors: rows.filter((r) => r.status === "error").length,
    warnings: rows.filter((r) => r.status === "warning").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    subjects: fileCodes.size,
    changedSubjects: diff.filter((d) => d.change !== "unchanged").length,
    newSubjects: new Set(valid.filter((r) => r.is_new_subject).map((r) => r.subject_code)).size,
    slotsAdded: diff.reduce((n, d) => n + d.added, 0),
    slotsRemoved: diff.reduce((n, d) => n + d.removed, 0),
    clashes: clashes.length
  };

  return { rows, diff, clashes, summary };
};

// ---------- notifications ----------

// code -> user ids of students registered for that subject in their current semester
const studentsTaking = async (codes) => {
  const regs = [];
  for (let i = 0; i < codes.length; i += 300) {
    const { data, error } = await supabase
      .from("Subject_Registrations")
      .select('student_id, semester, "subject code"')
      .in("subject code", codes.slice(i, i + 300));
    if (error) throw error;
    regs.push(...data);
  }
  const rolls = [...new Set(regs.map((r) => r.student_id))];
  const students = new Map();
  for (let i = 0; i < rolls.length; i += 300) {
    const { data, error } = await supabase
      .from("Student_Details")
      .select('"Roll Number", User_code, current_semester')
      .in("Roll Number", rolls.slice(i, i + 300));
    if (error) throw error;
    data.forEach((st) => students.set(st["Roll Number"], st));
  }
  const byCode = new Map(codes.map((c) => [c, new Set()]));
  regs.forEach((r) => {
    const st = students.get(r.student_id);
    // Old registrations from past semesters stay in the table; skip them
    if (st?.User_code && Number(st.current_semester) === Number(r.semester)) byCode.get(r["subject code"])?.add(st.User_code);
  });
  return byCode;
};

const slotText = (t) => `${t.day} ${t.start}–${t.end}${t.location ? ` (${t.location})` : ""}`;

// Fire-and-forget: tell a subject's students about one class change
const notifySubjectChange = (code, name, body) => {
  studentsTaking([code])
    .then((byCode) => sendPushToUsers([...byCode.get(code)].map((userId) => ({
      userId,
      type: "timetable",
      title: `Timetable change: ${code}`,
      body: `${name}: ${body}`,
      data: { screen: "TimeTable" }
    }))))
    .catch((err) => console.error("Failed to send timetable push", err));
};

// ---------- endpoints ----------

// GET /api/timetable/admin/branches -> B.Tech branches (the ones with curricula)
export const getTimetableBranches = async (req, res) => {
  try {
    const { data, error } = await supabase.from("branches").select("id, name").eq("course_id", 1).order("id");
    if (error) throw error;
    return res.status(200).json({ success: true, branches: data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// GET /api/timetable/admin/timings?branch_id=1&semester=5  or  ?q=CS3L
// Branch + semester -> every subject in that semester's curriculum (compulsory + choice options)
export const getAdminTimings = async (req, res) => {
  try {
    const { branch_id, semester } = req.query;
    const q = String(req.query.q || "").trim();
    let codes = null;
    let slots = [];

    if (branch_id && semester) {
      const { data, error } = await supabase
        .from("curriculum_slots")
        .select("id, slot_type, slot_label, curriculum_slot_options(subject_code)")
        .eq("branch_id", branch_id)
        .eq("semester", semester)
        .order("id");
      if (error) throw error;
      slots = data.map((s) => ({
        slot_type: s.slot_type,
        slot_label: s.slot_label,
        codes: s.curriculum_slot_options.map((o) => o.subject_code)
      }));
      codes = [...new Set(slots.flatMap((s) => s.codes))];
    } else if (q) {
      const like = `%${q.replace(/[%_,()]/g, "")}%`;
      const { data, error } = await supabase
        .from("Subject_Details")
        .select("subject_code")
        .or(`subject_code.ilike.${like},subject_name.ilike.${like}`)
        .limit(200);
      if (error) throw error;
      codes = data.map((s) => s.subject_code);
    } else {
      return res.status(400).json({ success: false, message: "Choose a branch and semester, or search for a subject" });
    }

    let timings = [];
    for (let i = 0; i < codes.length; i += 300) {
      const { data, error } = await supabase.from("Subject_Timings").select("*").in("subject_code", codes.slice(i, i + 300));
      if (error) throw error;
      timings.push(...data);
    }
    // Searching also matches rooms
    if (q && !(branch_id && semester)) {
      const { data, error } = await supabase.from("Subject_Timings").select("*").ilike("Location", `%${q.replace(/[%_,()]/g, "")}%`);
      if (error) throw error;
      const have = new Set(timings.map((t) => t.id));
      data.forEach((t) => { if (!have.has(t.id)) timings.push(t); });
    }

    const subjects = await fetchSubjects([...new Set([...codes, ...timings.map((t) => t.subject_code)])]);
    const withTimes = new Set(timings.map((t) => t.subject_code));

    return res.status(200).json({
      success: true,
      slots,
      timings: timings.map((t) => shapeTiming(t, subjects)),
      // Subjects in scope that have no class times yet
      unscheduled: codes.filter((c) => !withTimes.has(c)).map((c) => ({ subject_code: c, subject_name: subjects.get(c)?.name || c }))
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

const readSlotBody = (body) => {
  const day = normalizeDay(body.day);
  const start = parseTime(body.start);
  const end = parseTime(body.end);
  if (!day) return { error: "Choose a valid day" };
  if (start === null || end === null) return { error: "Enter valid start and end times" };
  if (end <= start) return { error: "End time must be after start time" };
  return {
    row: {
      day_of_the_week: day,
      start_time: `${fromMinutes(start)}:00`,
      end_time: `${fromMinutes(end)}:00`,
      Location: String(body.location || "").trim() || null
    }
  };
};

// Room clashes for one slot against everything else on that day
const findClashes = async (slot, ignoreId) => {
  if (!slot.Location) return [];
  const { data, error } = await supabase
    .from("Subject_Timings")
    .select("*")
    .eq("day_of_the_week", slot.day_of_the_week)
    .ilike("Location", slot.Location);
  if (error) throw error;
  const me = { day: slot.day_of_the_week, start: dbTime(slot.start_time), end: dbTime(slot.end_time) };
  return data
    .filter((t) => t.id !== ignoreId && overlaps(me, { day: t.day_of_the_week, start: dbTime(t.start_time), end: dbTime(t.end_time) }))
    .map((t) => `${t.subject_code} ${dbTime(t.start_time)}–${dbTime(t.end_time)}`);
};

// POST /api/timetable/admin/timings  { subject_code, day, start, end, location }
export const addAdminTiming = async (req, res) => {
  try {
    const code = String(req.body.subject_code || "").trim().toUpperCase();
    const { row, error: invalid } = readSlotBody(req.body);
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    const subjects = await fetchSubjects([code]);
    if (!subjects.has(code)) return res.status(400).json({ success: false, message: `Unknown subject code ${code}` });

    const { data, error } = await supabase.from("Subject_Timings").insert([{ subject_code: code, ...row }]).select().single();
    if (error) throw error;
    const clashes = await findClashes(data, data.id);
    const added = shapeTiming(data, subjects);
    notifySubjectChange(code, added.subject_name, `new class on ${slotText(added)}.`);
    return res.status(201).json({ success: true, timing: added, clashes });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// PATCH /api/timetable/admin/timings/:id  { day, start, end, location }
export const updateAdminTiming = async (req, res) => {
  try {
    const { row, error: invalid } = readSlotBody(req.body);
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    const { data: before, error: e0 } = await supabase.from("Subject_Timings").select("*").eq("id", req.params.id).maybeSingle();
    if (e0) throw e0;
    if (!before) return res.status(404).json({ success: false, message: "Class time not found" });
    const { data, error } = await supabase.from("Subject_Timings").update(row).eq("id", req.params.id).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: "Class time not found" });
    const subjects = await fetchSubjects([data.subject_code]);
    const clashes = await findClashes(data, data.id);
    const from = shapeTiming(before, subjects);
    const to = shapeTiming(data, subjects);
    if (slotText(from) !== slotText(to)) {
      const sameTime = from.day === to.day && from.start === to.start && from.end === to.end;
      notifySubjectChange(data.subject_code, to.subject_name, sameTime
        ? `${from.day} ${from.start}–${from.end} class moved to room ${to.location || "TBA"}.`
        : `${from.day} ${from.start}–${from.end} class moved to ${slotText(to)}.`);
    }
    return res.status(200).json({ success: true, timing: to, clashes });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// DELETE /api/timetable/admin/timings/:id
export const deleteAdminTiming = async (req, res) => {
  try {
    const { data, error } = await supabase.from("Subject_Timings").delete().eq("id", req.params.id).select();
    if (error) throw error;
    if (!data.length) return res.status(404).json({ success: false, message: "Class time not found" });
    fetchSubjects([data[0].subject_code])
      .then((subjects) => {
        const gone = shapeTiming(data[0], subjects);
        notifySubjectChange(gone.subject_code, gone.subject_name, `${gone.day} ${gone.start}–${gone.end} class has been removed from the timetable.`);
      })
      .catch((err) => console.error("Failed to send timetable push", err));
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// GET /api/timetable/admin/timings/export?branch_id=&semester=  (no filter = everything)
// Same columns as the upload template, so it doubles as the template.
export const exportAdminTimings = async (req, res) => {
  try {
    const { branch_id, semester } = req.query;
    let timings;
    if (branch_id && semester) {
      const { data, error } = await supabase
        .from("curriculum_slots")
        .select("curriculum_slot_options(subject_code)")
        .eq("branch_id", branch_id)
        .eq("semester", semester);
      if (error) throw error;
      const codes = [...new Set(data.flatMap((s) => s.curriculum_slot_options.map((o) => o.subject_code)))];
      timings = [];
      for (let i = 0; i < codes.length; i += 300) {
        const { data: part, error: e2 } = await supabase.from("Subject_Timings").select("*").in("subject_code", codes.slice(i, i + 300));
        if (e2) throw e2;
        timings.push(...part);
      }
    } else {
      timings = await pageAll(() => supabase.from("Subject_Timings").select("*").order("id"));
    }
    const subjects = await fetchSubjects([...new Set(timings.map((t) => t.subject_code))]);
    const order = (d) => DAYS.indexOf(d);
    const rows = timings
      .map((t) => shapeTiming(t, subjects))
      .sort((a, b) => a.subject_code.localeCompare(b.subject_code) || order(a.day) - order(b.day) || a.start.localeCompare(b.start))
      .map((t) => [t.subject_code, t.subject_name, t.day, t.start, t.end, t.location]);

    const sheet = xlsx.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...rows]);
    sheet["!cols"] = [{ wch: 14 }, { wch: 44 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 16 }];
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, sheet, "Timetable");
    const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="timetable.xlsx"');
    return res.send(buffer);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// POST /api/timetable/admin/timings/preview  (multipart "file") - writes nothing
export const previewTimetableUpload = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Attach an Excel or CSV file" });
    let raw;
    try {
      raw = readSheet(req.file.buffer);
    } catch {
      return res.status(400).json({ success: false, message: "Couldn't read that file. Upload the .xlsx template or a CSV." });
    }
    if (!raw) {
      return res.status(400).json({
        success: false,
        message: `Couldn't find the header row. The first sheet needs columns: ${TEMPLATE_HEADERS.join(", ")}.`
      });
    }
    if (raw.length === 0) return res.status(400).json({ success: false, message: "The file has no class rows" });
    if (raw.length > 5000) return res.status(400).json({ success: false, message: "Too many rows (max 5000)" });

    const result = await validateRows(raw);
    return res.status(200).json({ success: true, fileName: req.file.originalname, ...result });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// One notification per student, listing every one of their subjects whose times changed
const notifyUploadChanges = (changed) => {
  if (!changed.length) return;
  const names = new Map(changed.map((d) => [d.subject_code, d.subject_name]));
  studentsTaking([...names.keys()])
    .then((byCode) => {
      const perStudent = new Map();
      byCode.forEach((ids, code) => ids.forEach((id) => perStudent.set(id, [...(perStudent.get(id) || []), code])));
      return sendPushToUsers([...perStudent].map(([userId, codes]) => ({
        userId,
        type: "timetable",
        title: "Timetable updated",
        body: codes.length === 1
          ? `Class timings for ${codes[0]} ${names.get(codes[0])} have changed. Check your timetable.`
          : `Class timings changed for ${codes.slice(0, 3).join(", ")}${codes.length > 3 ? ` and ${codes.length - 3} more` : ""}. Check your timetable.`,
        data: { screen: "TimeTable" }
      })));
    })
    .catch((err) => console.error("Failed to send timetable push", err));
};

// POST /api/timetable/admin/timings/apply  { rows: [...] } - rows from the preview
export const applyTimetableUpload = async (req, res) => {
  try {
    const input = Array.isArray(req.body.rows) ? req.body.rows : null;
    if (!input || input.length === 0) return res.status(400).json({ success: false, message: "No rows to apply" });
    if (input.length > 5000) return res.status(400).json({ success: false, message: "Too many rows (max 5000)" });

    // Never trust the client's statuses: validate again
    const { rows, diff, summary } = await validateRows(input.map((r) => ({
      row: r.row,
      subject_code: r.subject_code,
      subject_name: r.subject_name,
      day: r.day,
      start: r.start,
      end: r.end,
      location: r.location
    })));
    if (summary.errors > 0) {
      return res.status(400).json({ success: false, message: `${summary.errors} row(s) still have errors. Fix the file and preview again.` });
    }

    const valid = rows.filter((r) => r.status === "ok" || r.status === "warning");
    const codes = [...new Set(valid.map((r) => r.subject_code))];

    const newSubjects = [...new Map(valid.filter((r) => r.is_new_subject).map((r) => [r.subject_code, r])).values()]
      .map((r) => ({ subject_code: r.subject_code, subject_name: r.subject_name }));
    if (newSubjects.length) {
      const { error } = await supabase.from("Subject_Details").upsert(newSubjects, { onConflict: "subject_code", ignoreDuplicates: true });
      if (error) throw error;
    }

    for (let i = 0; i < codes.length; i += 300) {
      const { error } = await supabase.from("Subject_Timings").delete().in("subject_code", codes.slice(i, i + 300));
      if (error) throw error;
    }
    const inserts = valid.map((r) => ({
      subject_code: r.subject_code,
      day_of_the_week: r.day,
      start_time: `${r.start}:00`,
      end_time: `${r.end}:00`,
      Location: r.location || null
    }));
    for (let i = 0; i < inserts.length; i += 500) {
      const { error } = await supabase.from("Subject_Timings").insert(inserts.slice(i, i + 500));
      if (error) throw error;
    }

    notifyUploadChanges(diff.filter((d) => d.change !== "unchanged"));

    return res.status(200).json({
      success: true,
      message: `Timetable updated: ${codes.length} subject(s), ${inserts.length} class time(s).`,
      subjects: codes.length,
      timings: inserts.length,
      newSubjects: newSubjects.length
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};
