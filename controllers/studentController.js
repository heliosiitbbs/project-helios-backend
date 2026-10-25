import supabase from "../config/Supabase.js";
import { computeFinalCycle, registerCoreSubjects, programmeName, LAST_SEMESTER, accessEndsAt } from "../utils/academics.js";

const HOSTEL_NAME_MAP = {
    "BHR": "Brahmaputra Hall",
    "GHR": "Ganga Hall",
    "MHR": "Mahanadi Hall",
    "SHR": "Subarnarekha Hall",
    "KHR": "Kangsabati Hall"
};

function getHostelNameFormatted(code) {
    if (!code) return "";
    const upper = String(code).trim().toUpperCase();
    return HOSTEL_NAME_MAP[upper] || code;
}

const STUDENT_WITH_USER_SELECT = `
    *,
    User_Details (
        id,
        "User Name",
        email_id,
        phone_number,
        photoUrl,
        is_Valid
    )
`;

function formatStudentRow(row) {
    const user = row.User_Details || {};
    const hostelCode = row.Hostel_Details || "";
    const hostelFullName = getHostelNameFormatted(hostelCode);

    return {
        // User & Account details
        user_id: user.id || row.User_code || null,
        name: user["User Name"] || null,
        email: user.email_id || null,
        phone_number: user.phone_number || null,
        photo: user.photoUrl || null,
        is_valid: user.is_Valid !== undefined ? user.is_Valid : null,
        expiry_date: user.expiry_date !== undefined ? user.expiry_date : null,

        // Roll Number aliases
        roll_number: row["Roll Number"] || null,
        "Roll Number": row["Roll Number"] || null,
        rollNumber: row["Roll Number"] || null,
        student_id: row["Roll Number"] || null,
        "Student ID": row["Roll Number"] || null,

        // Hostel aliases (returns both code and full name so frontend maps correctly)
        hostel: hostelCode,
        hostel_code: hostelCode,
        hostel_name: hostelFullName,
        Hostel_Details: hostelCode,
        "Hostel Details": hostelCode,
        Hostel: hostelCode,
        Hostel_Name: hostelFullName,
        "Hostel Name": hostelFullName,

        // Room No aliases
        room_number: row["Room No"] || null,
        room_no: row["Room No"] || null,
        "Room No": row["Room No"] || null,
        "Room Number": row["Room No"] || null,

        // Faculty Adviser aliases
        faculty_adviser: row["Faculty Adviser"] || null,
        "Faculty Adviser": row["Faculty Adviser"] || null,

        // Semester & Timestamp
        current_semester: row.current_semester !== undefined ? row.current_semester : null,
        degree: programmeName(row["Roll Number"]) || row.degree || null,
        last_semester: LAST_SEMESTER[programmeName(row["Roll Number"])] || null,
        access_ends_at: accessEndsAt(row.last_promoted_cycle)?.toISOString() || null,
        created_at: row.created_at || null
    };
}

// 2. Get Student By Roll Number (GET /api/students/:rollNumber)
export const getStudentByRollNumber = async (req, res) => {
    try {
        const { rollNumber } = req.params;

        const { data, error } = await supabase
            .from("Student_Details")
            .select(`
                *,
                User_Details (
                    id,
                    "User Name",
                    email_id,
                    phone_number,
                    photoUrl,
                    is_Valid
                )
            `)
            .ilike("Roll Number", rollNumber)
            .single();

        if (error || !data) {
            return res.status(404).json({
                success: false,
                message: "Student not found"
            });
        }

        return res.status(200).json({
            success: true,
            student: formatStudentRow(data)
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 8. Update Student Credentials (PUT /api/students/:rollNumber)
export const updateStudentCredentials = async (req, res) => {
    try {
        const { rollNumber } = req.params;
        const updateData = {};

        const hostel = req.body.Hostel_Details !== undefined ? req.body.Hostel_Details : req.body.hostel;
        const room = req.body["Room No"] !== undefined ? req.body["Room No"] : (req.body.room_no || req.body.room_number);
        const adviser = req.body["Faculty Adviser"] !== undefined ? req.body["Faculty Adviser"] : req.body.faculty_adviser;
        const semester = req.body.current_semester !== undefined ? req.body.current_semester : req.body.semester;
        const newRollRaw = req.body.new_roll_number;
        if (hostel !== undefined) updateData.Hostel_Details = hostel;
        if (room !== undefined) updateData["Room No"] = room;
        if (adviser !== undefined) updateData["Faculty Adviser"] = adviser === "" ? null : adviser;
        if (semester !== undefined) {
            const semesterNumber = Number(semester);
            if (!Number.isInteger(semesterNumber) || semesterNumber < 1 || semesterNumber > 20) {
                return res.status(400).json({ success: false, message: "Semester must be a whole number from 1 to 20" });
            }
            updateData.current_semester = semesterNumber;
        }

        // Roll number rename. Child tables (registrations, leave, grievances,
        // guest house) follow via ON UPDATE CASCADE foreign keys; gate_entries
        // has no foreign key, so it is repointed by hand below.
        const { data: existing, error: findError } = await supabase
            .from("Student_Details")
            .select(`"Roll Number"`)
            .ilike("Roll Number", rollNumber)
            .maybeSingle();

        if (findError) throw findError;
        if (!existing) {
            return res.status(404).json({ success: false, message: "Student not found" });
        }

        const oldRoll = existing["Roll Number"];
        let newRoll = null;

        if (newRollRaw !== undefined) {
            newRoll = String(newRollRaw).trim().toUpperCase();
            if (!/^[A-Z0-9]+$/.test(newRoll)) {
                return res.status(400).json({ success: false, message: "Roll number can only contain letters and digits" });
            }
            if (newRoll === oldRoll) {
                newRoll = null;
            } else {
                const { data: clash, error: clashError } = await supabase
                    .from("Student_Details")
                    .select(`"Roll Number"`)
                    .ilike("Roll Number", newRoll)
                    .maybeSingle();

                if (clashError) throw clashError;
                if (clash) {
                    return res.status(409).json({ success: false, message: `Roll number ${newRoll} already belongs to another student` });
                }
                updateData["Roll Number"] = newRoll;
            }
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No fields provided for update"
            });
        }

        // A new semester (e.g. repeating one) moves the end of the programme, so app access follows it
        const finalRoll = newRoll || oldRoll;
        if (updateData.current_semester !== undefined) {
            updateData.last_promoted_cycle = computeFinalCycle(finalRoll, updateData.current_semester);
        }

        const { data, error } = await supabase
            .from("Student_Details")
            .update(updateData)
            .eq("Roll Number", oldRoll)
            .select(STUDENT_WITH_USER_SELECT);

        if (error) {
            if (error.code === "23503") {
                return res.status(409).json({
                    success: false,
                    message: "This student has linked records (subjects, leave, grievances...), so the roll number can't be changed until the database foreign keys are set to ON UPDATE CASCADE."
                });
            }
            throw error;
        }
        if (!data || data.length === 0) {
            return res.status(404).json({ success: false, message: "Student not found" });
        }

        if (updateData.current_semester !== undefined) {
            try {
                await registerCoreSubjects([{ roll: finalRoll, semester: updateData.current_semester }]);
            } catch (coreErr) {
                console.error("Core subject registration failed:", coreErr);
            }
        }

        if (newRoll) {
            const { error: gateError } = await supabase
                .from("gate_entries")
                .update({ student_roll_number: newRoll })
                .eq("student_roll_number", oldRoll);

            if (gateError) console.error("Gate entries roll number update failed:", gateError);
        }

        return res.status(200).json({
            success: true,
            message: "Student credentials updated successfully",
            student: formatStudentRow(data[0])
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 9. Student Statistics (GET /api/students/stats)
export const getStudentStats = async (req, res) => {
    try {
        // Page through: PostgREST caps a single read at 1000 rows
        const students = [];
        for (let from = 0; ; from += 1000) {
            const { data, error: studentError } = await supabase
                .from("Student_Details")
                .select(`
                    current_semester,
                    Hostel_Details,
                    User_Details (
                        is_Valid
                    )
                `)
                .range(from, from + 999);

            if (studentError) throw studentError;
            students.push(...data);
            if (data.length < 1000) break;
        }

        let total_students = students.length;
        let total_active_students = 0;
        let total_invalid_accounts = 0;
        const students_in_each_hostel = {};
        const students_in_each_semester = {};

        students.forEach(st => {
            const h = st.Hostel_Details || "Unassigned";
            students_in_each_hostel[h] = (students_in_each_hostel[h] || 0) + 1;

            const sem = st.current_semester !== null && st.current_semester !== undefined ? `Semester ${st.current_semester}` : "Unassigned";
            students_in_each_semester[sem] = (students_in_each_semester[sem] || 0) + 1;

            if (st.User_Details) {
                if (st.User_Details.is_Valid === true) {
                    total_active_students++;
                } else {
                    total_invalid_accounts++;
                }
            }
        });

        return res.status(200).json({
            success: true,
            total_students,
            students_in_each_hostel,
            students_in_each_semester,
            total_active_students,
            total_invalid_accounts
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// Strips characters that would break PostgREST's or()/ilike filter syntax
const sanitizeSearch = (value) => String(value || "").replace(/[,()*%"\\]/g, " ").trim();

// GET /api/students/admin-list?query=&page=1&pageSize=25
// Server-side search (name or roll number) + paging, so the dashboard isn't
// limited by Supabase's 1000-row cap on a plain select.
export const adminListStudents = async (req, res) => {
    try {
        const query = sanitizeSearch(req.query.query);
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
        const from = (page - 1) * pageSize;

        let request = supabase
            .from("Student_Details")
            .select(STUDENT_WITH_USER_SELECT, { count: "exact" })
            .order("Roll Number", { ascending: true })
            .range(from, from + pageSize - 1);

        if (query) {
            const { data: nameMatches, error: nameError } = await supabase
                .from("User_Details")
                .select("id")
                .eq("User Type", "Student")
                .ilike("User Name", `%${query}%`)
                .limit(500);

            if (nameError) throw nameError;

            const filters = [`"Roll Number".ilike.*${query}*`];
            if (nameMatches.length > 0) {
                filters.push(`User_code.in.(${nameMatches.map(u => u.id).join(",")})`);
            }
            request = request.or(filters.join(","));
        }

        const { data, error, count } = await request;
        if (error) throw error;

        return res.status(200).json({
            success: true,
            total: count || 0,
            page,
            pageSize,
            students: data.map(formatStudentRow)
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// Looks up the student's canonical roll number + current semester, or sends a 404
const findStudentForSubjects = async (rollNumber, res) => {
    const { data, error } = await supabase
        .from("Student_Details")
        .select(`"Roll Number", current_semester`)
        .ilike("Roll Number", rollNumber)
        .maybeSingle();

    if (error) throw error;
    if (!data) {
        res.status(404).json({ success: false, message: "Student not found" });
        return null;
    }
    return { rollNumber: data["Roll Number"], semester: data.current_semester };
};

// GET /api/students/:rollNumber/subjects - registrations for the current semester
export const getStudentSubjects = async (req, res) => {
    try {
        const student = await findStudentForSubjects(req.params.rollNumber, res);
        if (!student) return;

        const { data: registrations, error } = await supabase
            .from("Subject_Registrations")
            .select("*")
            .eq("student_id", student.rollNumber)
            .eq("semester", student.semester);

        if (error) throw error;

        const codes = registrations.map(r => r["subject code"]);
        let subjects = [];
        if (codes.length > 0) {
            const { data, error: subjectsError } = await supabase
                .from("Subject_Details")
                .select("subject_code, subject_name, credits")
                .in("subject_code", codes);

            if (subjectsError) throw subjectsError;
            subjects = data;
        }

        const byCode = Object.fromEntries(subjects.map(s => [s.subject_code, s]));

        return res.status(200).json({
            success: true,
            semester: student.semester,
            subjects: registrations.map(r => ({
                id: r.id,
                subject_code: r["subject code"],
                subject_name: byCode[r["subject code"]]?.subject_name || r["subject code"],
                credits: byCode[r["subject code"]]?.credits ?? null,
                year: r.Year
            }))
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// POST /api/students/:rollNumber/subjects  { subject_code }
export const addStudentSubject = async (req, res) => {
    try {
        const subjectCode = String(req.body.subject_code || "").trim();
        if (!subjectCode) {
            return res.status(400).json({ success: false, message: "subject_code is required" });
        }

        const student = await findStudentForSubjects(req.params.rollNumber, res);
        if (!student) return;

        if (!student.semester) {
            return res.status(400).json({ success: false, message: "Set the student's semester before registering subjects" });
        }

        const { data: subject, error: subjectError } = await supabase
            .from("Subject_Details")
            .select("subject_code, subject_name, credits")
            .eq("subject_code", subjectCode)
            .maybeSingle();

        if (subjectError) throw subjectError;
        if (!subject) {
            return res.status(404).json({ success: false, message: `Subject ${subjectCode} not found` });
        }

        const { data: existing, error: existingError } = await supabase
            .from("Subject_Registrations")
            .select(`id, "subject code", Year`)
            .eq("student_id", student.rollNumber)
            .eq("semester", student.semester);

        if (existingError) throw existingError;

        if (existing.some(r => r["subject code"] === subjectCode)) {
            return res.status(409).json({ success: false, message: `${subjectCode} is already registered` });
        }

        // Same academic-year rule as the app's own registration flow
        const now = new Date();
        const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
        const academicYear = existing[0]?.Year || `${startYear}-${startYear + 1}`;

        const { data: inserted, error: insertError } = await supabase
            .from("Subject_Registrations")
            .insert([{
                student_id: student.rollNumber,
                "subject code": subjectCode,
                Year: academicYear,
                semester: student.semester
            }])
            .select("id, Year")
            .single();

        if (insertError) throw insertError;

        return res.status(201).json({
            success: true,
            message: "Subject registered",
            subject: {
                id: inserted.id,
                subject_code: subject.subject_code,
                subject_name: subject.subject_name,
                credits: subject.credits,
                year: inserted.Year
            }
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// DELETE /api/students/:rollNumber/subjects/:registrationId
export const removeStudentSubject = async (req, res) => {
    try {
        const student = await findStudentForSubjects(req.params.rollNumber, res);
        if (!student) return;

        const { data, error } = await supabase
            .from("Subject_Registrations")
            .delete()
            .eq("id", req.params.registrationId)
            .eq("student_id", student.rollNumber)
            .select("id");

        if (error) throw error;
        if (!data || data.length === 0) {
            return res.status(404).json({ success: false, message: "Registration not found for this student" });
        }

        return res.status(200).json({ success: true, message: "Subject removed" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// GET /api/students/subject-catalog?query=CSE - subject picker for the dashboard
export const searchSubjectCatalog = async (req, res) => {
    try {
        const query = sanitizeSearch(req.query.query);
        if (!query) {
            return res.status(200).json({ success: true, subjects: [] });
        }

        const { data, error } = await supabase
            .from("Subject_Details")
            .select("subject_code, subject_name, credits")
            .or(`subject_code.ilike.*${query}*,subject_name.ilike.*${query}*`)
            .order("subject_code")
            .limit(20);

        if (error) throw error;

        return res.status(200).json({ success: true, subjects: data });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};
