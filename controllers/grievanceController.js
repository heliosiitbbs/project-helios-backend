import supabase from "../config/Supabase.js";
import nodemailer from "nodemailer";

const escapeHtml = (text) =>
    String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Emails the Hostel Admin(s) of the student's hostel that a new grievance came in.
// Fire-and-forget from uploadGrievance: a mail problem never fails the submission.
const notifyHostelAdmins = async (grievance, studentRollNo) => {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;

    const { data: student, error: studentError } = await supabase
        .from("Student_Details")
        .select('"Roll Number", "Room No", Hostel_Details, User_Details("User Name", display_name)')
        .eq("Roll Number", studentRollNo)
        .maybeSingle();
    if (studentError) throw studentError;
    const hostel = student?.Hostel_Details;
    if (!hostel) return;

    const { data: admins, error: adminError } = await supabase
        .from("User_Details")
        .select("email_id")
        .eq("User Type", "Hostel Admin")
        .eq("Hostel", hostel)
        .eq("is_Valid", true);
    if (adminError) throw adminError;
    const recipients = (admins || []).map((a) => a.email_id).filter(Boolean);
    if (!recipients.length) {
        console.warn(`New grievance in ${hostel}, but no active Hostel Admin account has that hostel - no email sent.`);
        return;
    }

    const name = student.User_Details?.["User Name"] || student.User_Details?.display_name || "A student";
    const type = grievance["Grievance Type"] || "General";
    const roomNo = student["Room No"] ? String(student["Room No"]).trim() : "";
    const dashboard = process.env.ADMIN_DASHBOARD_URL || "https://helios-admin-frontend.vercel.app";

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS.replace(/\s+/g, ""),
        },
        // Fail fast where outbound SMTP is silently dropped (see authController)
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 8000,
    });

    await transporter.sendMail({
        from: `"Helios Grievances" <${process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@helios.iitbbs.ac.in"}>`,
        to: recipients,
        subject: `New ${type} grievance - ${hostel} - Helios IIT BBS`,
        // Room No: / Name: / Grievance: / link - room only when known
        text:
            (roomNo ? `Room No: ${roomNo}\n` : "") +
            `Name: ${name}\n` +
            `Grievance: ${grievance.description}\n\n` +
            `In order to allot this to someone, please follow the link: ${dashboard}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 520px; color: #181925; font-size: 15px; line-height: 1.6;">
                ${roomNo ? `<p style="margin: 0;"><b>Room No:</b> ${escapeHtml(roomNo)}</p>` : ""}
                <p style="margin: 0;"><b>Name:</b> ${escapeHtml(name)}</p>
                <p style="margin: 0; white-space: pre-wrap;"><b>Grievance:</b> ${escapeHtml(grievance.description)}</p>
                <p style="margin: 20px 0 0;">In order to allot this to someone, please follow the link: <a href="${escapeHtml(dashboard)}">${escapeHtml(dashboard)}</a></p>
            </div>
        `,
    });
};

// 2. UPLOAD NEW GRIEVANCE (Student)
export const uploadGrievance = async (req, res) => {
    const { description, proof, grievance_type } = req.body;

    // student_id is a foreign key to Student_Details."Roll Number", not User_Details.id -
    // students can only file on their own behalf; Admins may specify a student_id explicitly
    const student_id =
        req.user.user_type === "Admin" && req.body.student_id
            ? req.body.student_id
            : req.user.rollnumber;

    if (!student_id) {
        return res.status(400).json({ success: false, message: "Only students can file grievances." });
    }

    if (!description) {
        return res.status(400).json({ success: false, message: "description is required." });
    }

    try {
        let proofValue = proof || null;

        // If a proof photo was attached, upload it to Supabase Storage and store its public URL
        if (req.file) {
            const fileExtension = req.file.originalname.split(".").pop();
            const safeStudentId = String(student_id).replace(/[^a-zA-Z0-9]/g, "_");
            const filePath = `grievance_proofs/${safeStudentId}_${Date.now()}.${fileExtension}`;

            const { data: uploadData, error: uploadError } = await supabase.storage
                .from("grievance_proofs")
                .upload(filePath, req.file.buffer, {
                    contentType: req.file.mimetype
                });

            if (uploadError) {
                console.error(uploadError);
                return res.status(500).json({
                    success: false,
                    message: "Error uploading proof photo"
                });
            }

            const { data: publicUrlData } = supabase.storage
                .from("grievance_proofs")
                .getPublicUrl(uploadData.path);

            proofValue = publicUrlData.publicUrl;
        }

        const { data, error } = await supabase
            .from("Hostel_Grievances")
            .insert([
                {
                    student_id,
                    description,
                    proof: proofValue,
                    "Grievance Type": grievance_type || null, // Handles space in your Supabase column name
                    is_resolved: false // Defaults to unresolved
                }
            ])
            .select()
            .single();

        if (error) throw error;

        notifyHostelAdmins(data, student_id).catch((err) => console.error("Failed to email hostel admins about grievance:", err.message));

        return res.status(201).json({ success: true, message: "Grievance submitted successfully.", grievance: data });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Error uploading grievance."});
    }
};

// 3. ASSIGN GRIEVANCE (Admin)
export const assignGrievance = async (req, res) => {
    const { grievance_id, assigned_to } = req.body; // grievance_id maps to your 'id' column

    if (!grievance_id || !assigned_to) {
        return res.status(400).json({ success: false, message: "grievance_id and assigned_to are required." });
    }

    // "assigned to" is a foreign key to User_Details.id (integer), not a free-text name
    const assignedToId = Number(assigned_to);
    if (!Number.isInteger(assignedToId)) {
        return res.status(400).json({ success: false, message: "assigned_to must be a numeric user ID." });
    }

    try {
        const { data, error } = await supabase
            .from("Hostel_Grievances")
            .update({ "assigned to": assignedToId }) // Handles space in 'assigned to' column
            .eq("id", grievance_id)
            .select()
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, message: "Grievance record not found." });

        return res.status(200).json({ success: true, message: `Grievance successfully assigned to ID: ${assigned_to}`, grievance: data });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Error assigning grievance."});
    }
};

// 4. MARK RESOLVED - only the student who filed it decides it's fixed
export const markResolved = async (req, res) => {
    const { grievance_id } = req.body;

    if (!grievance_id) {
        return res.status(400).json({ success: false, message: "grievance_id is required." });
    }

    if (!req.user.rollnumber) {
        return res.status(403).json({ success: false, message: "Only the student who filed a grievance can mark it resolved." });
    }

    try {
        const { data, error } = await supabase
            .from("Hostel_Grievances")
            .update({ is_resolved: true, resolved_at: new Date().toISOString() })
            .eq("id", grievance_id)
            .eq("student_id", req.user.rollnumber)
            .select()
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, message: "Grievance record not found." });

        return res.status(200).json({ success: true, message: "Grievance marked as resolved.", grievance: data });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Error resolving grievance."});
    }
};

// 5. GET GRIEVANCE HISTORY BY STUDENT
export const getGrievanceHistory = async (req, res) => {
    const requestedStudentId = req.query?.student_id || req.body?.student_id;

    // Non-admins can only ever read their own history, regardless of what's requested.
    // student_id is a foreign key to Student_Details."Roll Number", not User_Details.id.
    const student_id =
        req.user.user_type === "Admin" && requestedStudentId
            ? requestedStudentId
            : req.user.rollnumber;

    if (!student_id) {
        return res.status(400).json({ success: false, message: "Only students have grievance history." });
    }

    try {
        const { data, error } = await supabase
            .from("Hostel_Grievances")
            .select("*")
            .eq("student_id", student_id)
            .order("created_at", { ascending: false });

        if (error) throw error;

        // Who the hostel admin assigned each grievance to (hostel_staff has no app accounts)
        const staffIds = [...new Set(data.map((g) => g.assigned_staff_id).filter(Boolean))];
        let staff = new Map();
        if (staffIds.length) {
            const { data: members, error: staffError } = await supabase
                .from("hostel_staff")
                .select("id, name, role, phone")
                .in("id", staffIds);
            if (staffError) throw staffError;
            staff = new Map(members.map((m) => [m.id, m]));
        }

        // Progress notes the assigned staff left ("needs 2 more days"), newest first
        let updates = [];
        if (data.length) {
            const { data: rows, error: updatesError } = await supabase
                .from("grievance_updates")
                .select("id, grievance_id, staff_name, note, created_at")
                .in("grievance_id", data.map((g) => g.id))
                .order("created_at", { ascending: false });
            // Notes are a bonus - never let them stop the student seeing their own grievances
            if (updatesError) console.error("Could not load grievance updates:", updatesError.message);
            else updates = rows;
        }

        const history = data.map((g) => ({
            ...g,
            staff: g.assigned_staff_id ? staff.get(g.assigned_staff_id) || null : null,
            updates: updates.filter((u) => u.grievance_id === g.id)
        }));

        return res.status(200).json({ success: true, count: history.length, history });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Error pulling grievance history."});
    }
};

// 6. GET ALL GRIEVANCES (RESOLVED & UNRESOLVED)
export const getAllGrievances = async (req, res) => {
    try {
        const { data, error } = await supabase
           .from("Hostel_Grievances")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) throw error;

        return res.status(200).json({ success: true, count: data.length, grievances: data });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Error pulling all grievances."});
    }
};