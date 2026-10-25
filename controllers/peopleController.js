import xlsx from "xlsx";
import supabase from "../config/Supabase.js";
import {
    PROGRAMMES,
    parseRollNumber,
    defaultSemester,
    computeFinalCycle,
    registerCoreSubjects
} from "../utils/academics.js";

// Super Admin: add students (one at a time or from a spreadsheet) and visitors.
// Everyone signs in with Google using the email stored here, so no password is set.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BULK_ROWS = 2000;

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const serverError = (res, err) => {
    console.error(err);
    return fail(res, 500, "Server Error");
};

// Validates one student row; returns { student } or { error }
const readStudent = (input) => {
    const roll = String(input.roll_number || "").replace(/\s+/g, "").toUpperCase();
    const name = String(input.name || "").replace(/\s+/g, " ").trim();
    const parsed = parseRollNumber(roll);
    if (!parsed) return { error: "Roll number doesn't look valid (e.g. 26CS01001 or A26CE09001)" };
    const programme = PROGRAMMES[parsed.courseCode];
    if (!programme) return { error: `Unknown programme code ${parsed.courseCode} in the roll number` };
    if (name.length < 2) return { error: "Enter the student's name" };

    const email = String(input.email || `${roll.toLowerCase()}@iitbbs.ac.in`).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { error: "Email doesn't look valid" };

    let semester = input.semester === undefined || input.semester === "" || input.semester === null
        ? defaultSemester(roll)
        : Number(input.semester);
    if (!Number.isInteger(semester) || semester < 1 || semester > 20) return { error: "Semester must be a whole number from 1 to 20" };

    return {
        student: {
            roll,
            name,
            email,
            semester,
            hostel: String(input.hostel || "").trim().toUpperCase() || null,
            room: String(input.room || "").trim() || null,
            programme: programme.course,
            branch: programme.branches[parsed.branchCode] || null
        }
    };
};

// Roll numbers and emails that already exist, out of the given ones
const findExisting = async (students) => {
    const rolls = new Set(), emails = new Set();
    for (let i = 0; i < students.length; i += 300) {
        const chunk = students.slice(i, i + 300);
        const [{ data: r, error: e1 }, { data: e, error: e2 }] = await Promise.all([
            supabase.from("Student_Details").select(`"Roll Number"`).in("Roll Number", chunk.map((s) => s.roll)),
            supabase.from("User_Details").select("email_id").in("email_id", chunk.map((s) => s.email))
        ]);
        if (e1 || e2) throw e1 || e2;
        r.forEach((x) => rolls.add(x["Roll Number"]));
        e.forEach((x) => emails.add(String(x.email_id).toLowerCase()));
    }
    return { rolls, emails };
};

// course_id / branch_id for a programme + branch name
const loadProgrammeIds = async () => {
    const [{ data: courses, error: e1 }, { data: branches, error: e2 }] = await Promise.all([
        supabase.from("courses").select("id, name"),
        supabase.from("branches").select("id, course_id, name")
    ]);
    if (e1 || e2) throw e1 || e2;
    return (programme, branch) => {
        const course = courses.find((c) => c.name === programme);
        const b = course && branches.find((x) => x.course_id === course.id && x.name === branch);
        return { course_id: course?.id ?? null, branch_id: b?.id ?? null };
    };
};

// Inserts already-validated, non-duplicate students. Returns [{ roll, ok, error? }]
const insertStudents = async (students) => {
    const idsFor = await loadProgrammeIds();
    const results = [];
    for (const s of students) {
        const { data: user, error: userError } = await supabase
            .from("User_Details")
            .insert({ "User Name": s.name, email_id: s.email, "User Type": "Student", is_Valid: true })
            .select("id")
            .single();
        if (userError) {
            results.push({ roll: s.roll, ok: false, error: "Could not create the account" });
            console.error(userError);
            continue;
        }
        const { error: studentError } = await supabase.from("Student_Details").insert({
            "Roll Number": s.roll,
            User_code: user.id,
            Hostel_Details: s.hostel,
            "Room No": s.room || "",
            current_semester: s.semester,
            degree: s.programme,
            last_promoted_cycle: computeFinalCycle(s.roll, s.semester),
            ...idsFor(s.programme, s.branch)
        });
        if (studentError) {
            // Don't leave an account without its student record
            await supabase.from("User_Details").delete().eq("id", user.id);
            results.push({ roll: s.roll, ok: false, error: "Could not create the student record" });
            console.error(studentError);
            continue;
        }
        results.push({ roll: s.roll, ok: true });
    }
    const added = students.filter((s) => results.find((r) => r.roll === s.roll && r.ok));
    if (added.length) {
        try {
            await registerCoreSubjects(added.map((s) => ({ roll: s.roll, semester: s.semester })));
        } catch (err) {
            console.error("Core subject registration failed:", err);
        }
    }
    return results;
};

// POST /api/people/students { roll_number, name, email?, hostel?, room?, semester? }
export const addStudent = async (req, res) => {
    try {
        const { student, error } = readStudent(req.body || {});
        if (error) return fail(res, 400, error);
        const { rolls, emails } = await findExisting([student]);
        if (rolls.has(student.roll)) return fail(res, 409, `${student.roll} is already registered`);
        if (emails.has(student.email)) return fail(res, 409, `${student.email} already has an account`);

        const [result] = await insertStudents([student]);
        if (!result.ok) return fail(res, 500, result.error);
        return res.status(201).json({ success: true, student });
    } catch (err) {
        return serverError(res, err);
    }
};

// Column headers accepted in the spreadsheet (case and spacing ignored)
const COLUMNS = {
    roll_number: ["roll number", "roll no", "roll", "rollno"],
    name: ["name", "student name", "name of the student", "name of the students"],
    email: ["email", "email id", "mail"],
    hostel: ["hostel", "hall"],
    room: ["room", "room no", "room number"],
    semester: ["semester", "sem"]
};
const normalise = (h) => String(h || "").toLowerCase().replace(/[^a-z]+/g, " ").trim();

// POST /api/people/students/preview (multipart "file") - checks every row, writes nothing
export const previewStudents = async (req, res) => {
    try {
        if (!req.file) return fail(res, 400, "Attach an Excel or CSV file");
        const wb = xlsx.read(req.file.buffer, { type: "buffer" });
        const grid = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });

        // First row that has a roll number column is the header
        const headerIndex = grid.findIndex((row) => row.some((h) => COLUMNS.roll_number.includes(normalise(h))));
        if (headerIndex < 0) return fail(res, 400, "Couldn't find a 'Roll Number' column in the first sheet");
        const header = grid[headerIndex].map(normalise);
        const col = Object.fromEntries(Object.entries(COLUMNS).map(([key, names]) => [key, header.findIndex((h) => names.includes(h))]));
        if (col.name < 0) return fail(res, 400, "Couldn't find a 'Name' column in the first sheet");

        const dataRows = grid.slice(headerIndex + 1).filter((row) => String(row[col.roll_number] || "").trim());
        if (dataRows.length > MAX_BULK_ROWS) return fail(res, 400, `At most ${MAX_BULK_ROWS} students per file`);

        const rows = dataRows.map((row) => {
            const input = Object.fromEntries(Object.entries(col).filter(([, i]) => i >= 0).map(([key, i]) => [key, row[i]]));
            const { student, error } = readStudent(input);
            return student ? { ...student, error: null } : { roll: String(input.roll_number || ""), name: String(input.name || ""), error };
        });

        const valid = rows.filter((r) => !r.error);
        const { rolls, emails } = await findExisting(valid);
        const seen = new Set();
        for (const r of valid) {
            if (rolls.has(r.roll)) r.error = "Already registered";
            else if (emails.has(r.email)) r.error = "Email already has an account";
            else if (seen.has(r.roll)) r.error = "Repeated in this file";
            seen.add(r.roll);
        }
        return res.status(200).json({
            success: true,
            rows,
            ready: rows.filter((r) => !r.error).length,
            skipped: rows.filter((r) => r.error).length
        });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /api/people/students/bulk { students: [...] } - adds the rows a preview marked ready
export const addStudentsBulk = async (req, res) => {
    try {
        const input = Array.isArray(req.body?.students) ? req.body.students : [];
        if (!input.length) return fail(res, 400, "No students to add");
        if (input.length > MAX_BULK_ROWS) return fail(res, 400, `At most ${MAX_BULK_ROWS} students at a time`);

        const students = [], results = [];
        for (const row of input) {
            const { student, error } = readStudent(row);
            if (error) results.push({ roll: String(row.roll_number || ""), ok: false, error });
            else students.push(student);
        }
        const { rolls, emails } = await findExisting(students);
        const fresh = students.filter((s) => {
            const clash = rolls.has(s.roll) ? "Already registered" : emails.has(s.email) ? "Email already has an account" : null;
            if (clash) results.push({ roll: s.roll, ok: false, error: clash });
            return !clash;
        });
        results.push(...await insertStudents(fresh));
        return res.status(200).json({
            success: true,
            added: results.filter((r) => r.ok).length,
            failed: results.filter((r) => !r.ok)
        });
    } catch (err) {
        return serverError(res, err);
    }
};

// ---------- Visitors ----------
// The account (User_Details, type "Visitor") holds name, email and phone. The visit itself -
// when it starts and ends, the campus contact and the purpose - lives in Visitor_Details.
// expiry_date mirrors entry_end, so the nightly expiry job archives and removes the account afterwards.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Visit details shared by one visitor or a whole spreadsheet; returns { visit } or { error }
const readVisit = (input) => {
    const start = String(input.entry_start || "");
    const end = String(input.entry_end || "");
    const contact = String(input.campus_contact || "").replace(/\s+/g, " ").trim();
    const purpose = String(input.purpose || "").replace(/\s+/g, " ").trim();
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) return { error: "Choose the first and last day of the visit" };
    const entryStart = new Date(`${start}T00:00:00+05:30`);
    const entryEnd = new Date(`${end}T23:59:59+05:30`);
    if (Number.isNaN(entryStart.getTime()) || Number.isNaN(entryEnd.getTime())) return { error: "Visit dates are not valid" };
    if (entryEnd < entryStart) return { error: "The last day can't be before the first day" };
    if (entryEnd <= new Date()) return { error: "The visit must end in the future" };
    if (contact.length < 2) return { error: "Enter the campus contact" };
    if (purpose.length < 2) return { error: "Enter the purpose of the visit" };
    return {
        visit: {
            entry_start: entryStart.toISOString(),
            entry_end: entryEnd.toISOString(),
            campus_contact: contact.slice(0, 200),
            purpose: purpose.slice(0, 500)
        }
    };
};

// One visitor's identity; returns { person } or { error }
const readVisitorPerson = (input) => {
    const name = String(input.name || "").replace(/\s+/g, " ").trim();
    const email = String(input.email || "").trim().toLowerCase();
    const phone = String(input.phone || "").replace(/[\s-]/g, "").replace(/^\+?91(?=\d{10}$)/, "");
    if (name.length < 2) return { error: "Enter the visitor's name" };
    if (!EMAIL_RE.test(email)) return { error: "Email doesn't look valid" };
    if (phone && !/^[6-9]\d{9}$/.test(phone)) return { error: "Phone must be a 10-digit mobile number" };
    return { person: { name, email, phone: phone || null } };
};

const visitStatus = (v) => {
    const now = new Date();
    if (!v.active) return "ended";
    if (v.entry_start && new Date(v.entry_start) > now) return "upcoming";
    if (v.entry_end && new Date(v.entry_end) <= now) return "ended";
    return "active";
};

// Creates each visitor account + Visitor_Details row. Returns [{ email, ok, error? }]
const insertVisitors = async (people, visit, addedBy) => {
    const results = [];
    for (const p of people) {
        const { data: user, error: userError } = await supabase
            .from("User_Details")
            .insert({ "User Name": p.name, email_id: p.email, phone_number: p.phone, "User Type": "Visitor", is_Valid: true, expiry_date: visit.entry_end })
            .select("id")
            .single();
        if (userError) {
            console.error(userError);
            results.push({ email: p.email, ok: false, error: "Could not create the account" });
            continue;
        }
        const { error: visitError } = await supabase.from("Visitor_Details").insert({ user_id: user.id, ...visit, added_by: addedBy });
        if (visitError) {
            console.error(visitError);
            await supabase.from("User_Details").delete().eq("id", user.id);
            results.push({ email: p.email, ok: false, error: "Could not save the visit details" });
            continue;
        }
        results.push({ email: p.email, ok: true, id: user.id });
    }
    return results;
};

// Emails that already have an account
const existingEmails = async (emails) => {
    const found = new Set();
    for (let i = 0; i < emails.length; i += 300) {
        const { data, error } = await supabase.from("User_Details").select("email_id").in("email_id", emails.slice(i, i + 300));
        if (error) throw error;
        data.forEach((r) => found.add(String(r.email_id).toLowerCase()));
    }
    return found;
};

// GET /api/people/visitors - most recent first, with their visit details
export const listVisitors = async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from("User_Details")
            .select(`id, "User Name", email_id, phone_number, expiry_date, is_Valid`)
            .eq("User Type", "Visitor")
            .order("id", { ascending: false })
            .limit(300);
        if (error) throw error;

        const { data: visits, error: visitError } = users.length
            ? await supabase.from("Visitor_Details").select("user_id, entry_start, entry_end, campus_contact, purpose").in("user_id", users.map((u) => u.id))
            : { data: [], error: null };
        if (visitError) throw visitError;
        const visitOf = Object.fromEntries(visits.map((v) => [v.user_id, v]));

        return res.status(200).json({
            success: true,
            visitors: users.map((u) => {
                const v = visitOf[u.id] || {};
                const row = {
                    id: u.id,
                    name: u["User Name"],
                    email: u.email_id,
                    phone: u.phone_number,
                    entry_start: v.entry_start || null,
                    entry_end: v.entry_end || u.expiry_date || null,
                    campus_contact: v.campus_contact || null,
                    purpose: v.purpose || null,
                    active: u.is_Valid === true
                };
                return { ...row, status: visitStatus(row) };
            })
        });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /api/people/visitors { name, email, phone?, entry_start, entry_end, campus_contact, purpose }
export const addVisitor = async (req, res) => {
    try {
        const { person, error: personError } = readVisitorPerson(req.body || {});
        if (personError) return fail(res, 400, personError);
        const { visit, error: visitError } = readVisit(req.body || {});
        if (visitError) return fail(res, 400, visitError);
        if ((await existingEmails([person.email])).has(person.email)) return fail(res, 409, `${person.email} already has an account`);

        const [result] = await insertVisitors([person], visit, req.user.id);
        if (!result.ok) return fail(res, 500, result.error);
        return res.status(201).json({ success: true, visitor: { id: result.id, ...person, ...visit, active: true, status: visitStatus({ ...visit, active: true }) } });
    } catch (err) {
        return serverError(res, err);
    }
};

const VISITOR_COLUMNS = {
    name: ["name", "full name", "visitor name"],
    email: ["email", "email id", "mail", "gmail"],
    phone: ["phone", "phone number", "mobile", "mobile number", "contact number"]
};

// POST /api/people/visitors/preview (multipart "file") - Name and Email columns; writes nothing
export const previewVisitors = async (req, res) => {
    try {
        if (!req.file) return fail(res, 400, "Attach an Excel or CSV file");
        const wb = xlsx.read(req.file.buffer, { type: "buffer" });
        const grid = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
        const headerIndex = grid.findIndex((row) => row.some((h) => VISITOR_COLUMNS.email.includes(normalise(h))));
        if (headerIndex < 0) return fail(res, 400, "Couldn't find an 'Email' column in the first sheet");
        const header = grid[headerIndex].map(normalise);
        const col = Object.fromEntries(Object.entries(VISITOR_COLUMNS).map(([key, names]) => [key, header.findIndex((h) => names.includes(h))]));
        if (col.name < 0) return fail(res, 400, "Couldn't find a 'Name' column in the first sheet");

        const dataRows = grid.slice(headerIndex + 1).filter((row) => String(row[col.name] || "").trim() || String(row[col.email] || "").trim());
        if (dataRows.length > MAX_BULK_ROWS) return fail(res, 400, `At most ${MAX_BULK_ROWS} visitors per file`);

        const rows = dataRows.map((row) => {
            const input = Object.fromEntries(Object.entries(col).filter(([, i]) => i >= 0).map(([key, i]) => [key, row[i]]));
            const { person, error } = readVisitorPerson(input);
            return person ? { ...person, error: null } : { name: String(input.name || ""), email: String(input.email || ""), phone: null, error };
        });
        const taken = await existingEmails(rows.filter((r) => !r.error).map((r) => r.email));
        const seen = new Set();
        for (const r of rows.filter((x) => !x.error)) {
            if (taken.has(r.email)) r.error = "Already has an account";
            else if (seen.has(r.email)) r.error = "Repeated in this file";
            seen.add(r.email);
        }
        return res.status(200).json({ success: true, rows, ready: rows.filter((r) => !r.error).length, skipped: rows.filter((r) => r.error).length });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /api/people/visitors/bulk { visitors: [{ name, email, phone? }], entry_start, entry_end, campus_contact, purpose }
export const addVisitorsBulk = async (req, res) => {
    try {
        const input = Array.isArray(req.body?.visitors) ? req.body.visitors : [];
        if (!input.length) return fail(res, 400, "No visitors to add");
        if (input.length > MAX_BULK_ROWS) return fail(res, 400, `At most ${MAX_BULK_ROWS} visitors at a time`);
        const { visit, error: visitError } = readVisit(req.body || {});
        if (visitError) return fail(res, 400, visitError);

        const people = [], results = [];
        for (const row of input) {
            const { person, error } = readVisitorPerson(row);
            if (error) results.push({ email: String(row.email || ""), ok: false, error });
            else people.push(person);
        }
        const taken = await existingEmails(people.map((p) => p.email));
        const fresh = people.filter((p) => {
            if (taken.has(p.email)) results.push({ email: p.email, ok: false, error: "Already has an account" });
            return !taken.has(p.email);
        });
        results.push(...await insertVisitors(fresh, visit, req.user.id));
        return res.status(200).json({ success: true, added: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) });
    } catch (err) {
        return serverError(res, err);
    }
};
