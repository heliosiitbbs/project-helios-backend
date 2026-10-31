import supabase from "../config/Supabase.js";
import { sendMail, mailConfigured } from "../utils/mailer.js";

const escapeHtml = (text) =>
    String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const formatIST = (iso) =>
    new Date(iso || Date.now()).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }) + " IST";

// The email a hostel admin gets for a new grievance: subject, plain text and HTML.
// Kept separate from the sending so the layout can be previewed on its own.
export const grievanceEmail = ({ grievance, hostel, student, dashboard }) => {
    const ref = `#${grievance.id}`;
    const category = grievance["Grievance Type"] || "General";
    const submitted = formatIST(grievance.created_at);
    const location = [student.room && `Room ${student.room}`, hostel].filter(Boolean).join(", ");

    const details = [
        ["Reference", ref],
        ["Category", category],
        ["Submitted", submitted],
        ["Student", student.name],
        ["Roll number", student.roll],
        ["Location", location],
        ["Phone", student.phone],
    ].filter(([, value]) => value);

    const subject = `New grievance ${ref}: ${category}${student.room ? ` · Room ${student.room}` : ""} · ${hostel}`;

    const text = [
        `Dear ${hostel} Hostel Admin,`,
        "",
        "A new grievance has been submitted on Helios and is waiting to be assigned.",
        "",
        ...details.map(([label, value]) => `${label}: ${value}`),
        "",
        "Description:",
        grievance.description,
        "",
        ...(grievance.proof ? [`Attached photo: ${grievance.proof}`, ""] : []),
        `To assign it to a staff member, open the Helios admin dashboard: ${dashboard}`,
        "",
        "Regards,",
        "Helios, IIT Bhubaneswar",
        "",
        "This is an automated message. Please do not reply to this email.",
    ].join("\n");

    const row = ([label, value]) => `
        <tr>
            <td style="padding: 8px 0; width: 120px; color: #6B6A75; font-size: 13px; vertical-align: top;">${escapeHtml(label)}</td>
            <td style="padding: 8px 0; color: #17171C; font-size: 14px; font-weight: 600; vertical-align: top;">${escapeHtml(value)}</td>
        </tr>`;

    const html = `<!doctype html>
<html>
<body style="margin: 0; padding: 0; background: #F4F3EF;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #F4F3EF; padding: 32px 12px;">
        <tr><td align="center">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background: #FFFFFF; border-radius: 16px; overflow: hidden; font-family: Arial, Helvetica, sans-serif;">
                <tr>
                    <td style="background: #17171C; padding: 22px 28px;">
                        <div style="color: #D9F25A; font-size: 12px; font-weight: 700; letter-spacing: 1.5px;">HELIOS · ${escapeHtml(hostel.toUpperCase())} GRIEVANCES</div>
                        <div style="color: #FFFFFF; font-size: 22px; font-weight: 700; margin-top: 6px;">New grievance ${escapeHtml(ref)}</div>
                    </td>
                </tr>
                <tr>
                    <td style="padding: 26px 28px 8px;">
                        <p style="margin: 0 0 6px; color: #17171C; font-size: 15px;">Dear ${escapeHtml(hostel)} Hostel Admin,</p>
                        <p style="margin: 0; color: #3D3D46; font-size: 15px; line-height: 1.55;">A new grievance has been submitted on Helios and is waiting to be assigned.</p>
                    </td>
                </tr>
                <tr>
                    <td style="padding: 12px 28px;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top: 1px solid #ECEAE3; border-bottom: 1px solid #ECEAE3;">
                            ${details.map(row).join("")}
                        </table>
                    </td>
                </tr>
                <tr>
                    <td style="padding: 8px 28px 4px;">
                        <div style="color: #6B6A75; font-size: 13px; margin-bottom: 8px;">Description</div>
                        <div style="background: #F7F6F2; border-left: 4px solid #17171C; border-radius: 8px; padding: 14px 16px; color: #17171C; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(grievance.description)}</div>
                    </td>
                </tr>
                ${grievance.proof ? `
                <tr>
                    <td style="padding: 16px 28px 4px;">
                        <div style="color: #6B6A75; font-size: 13px; margin-bottom: 8px;">Attached photo</div>
                        <a href="${escapeHtml(grievance.proof)}"><img src="${escapeHtml(grievance.proof)}" alt="Photo attached to the grievance" width="504" style="display: block; width: 100%; max-width: 504px; border-radius: 10px; border: 1px solid #ECEAE3;"></a>
                    </td>
                </tr>` : ""}
                <tr>
                    <td style="padding: 24px 28px 8px;">
                        <a href="${escapeHtml(dashboard)}" style="display: inline-block; background: #17171C; color: #D9F25A; text-decoration: none; font-size: 14px; font-weight: 700; padding: 14px 24px; border-radius: 999px;">Assign in Helios admin</a>
                    </td>
                </tr>
                <tr>
                    <td style="padding: 18px 28px 26px; color: #3D3D46; font-size: 14px; line-height: 1.55;">
                        Regards,<br>Helios, IIT Bhubaneswar
                    </td>
                </tr>
                <tr>
                    <td style="padding: 14px 28px; background: #F7F6F2; color: #8A8994; font-size: 12px; line-height: 1.5;">
                        This is an automated message sent because you are the Hostel Admin for ${escapeHtml(hostel)}. Please do not reply to this email.
                    </td>
                </tr>
            </table>
        </td></tr>
    </table>
</body>
</html>`;

    return { subject, text, html };
};

// Emails the Hostel Admin(s) of the student's hostel that a new grievance came in.
// Fire-and-forget from uploadGrievance: a mail problem never fails the submission,
// but every reason a mail doesn't go out is logged.
const notifyHostelAdmins = async (grievance, studentRollNo) => {
    if (!mailConfigured()) {
        console.warn(`Grievance #${grievance.id}: email isn't configured (SMTP_USER + SMTP_PASS) - hostel admin not emailed.`);
        return;
    }

    const { data: student, error: studentError } = await supabase
        .from("Student_Details")
        .select('"Roll Number", "Room No", Hostel_Details, User_Details("User Name", display_name, phone_number)')
        .eq("Roll Number", studentRollNo)
        .maybeSingle();
    if (studentError) throw studentError;
    const hostel = student?.Hostel_Details;
    if (!hostel) {
        console.warn(`Grievance #${grievance.id}: student ${studentRollNo} has no hostel on record - hostel admin not emailed.`);
        return;
    }

    const { data: admins, error: adminError } = await supabase
        .from("User_Details")
        .select("email_id")
        .eq("User Type", "Hostel Admin")
        .eq("Hostel", hostel)
        .eq("is_Valid", true);
    if (adminError) throw adminError;
    const recipients = (admins || []).map((a) => a.email_id).filter(Boolean);
    if (!recipients.length) {
        console.warn(`Grievance #${grievance.id}: no active Hostel Admin account for hostel "${hostel}" - no email sent.`);
        return;
    }

    const person = student.User_Details || {};
    const { subject, text, html } = grievanceEmail({
        grievance,
        hostel,
        dashboard: process.env.ADMIN_DASHBOARD_URL || "https://helios-admin-frontend.vercel.app",
        student: {
            name: person.display_name || person["User Name"] || studentRollNo,
            roll: student["Roll Number"],
            room: student["Room No"] ? String(student["Room No"]).trim() : "",
            phone: person.phone_number || "",
        },
    });

    await sendMail({ fromName: "Helios Grievances", to: recipients, subject, text, html });
    console.log(`Grievance #${grievance.id}: emailed ${recipients.join(", ")}`);
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

        notifyHostelAdmins(data, student_id).catch((err) => console.error(`Grievance #${data.id}: failed to email the hostel admin:`, err.message));

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

// DELETE /api/grievances/:id - the student who filed a grievance can withdraw it
export const deleteGrievance = async (req, res) => {
    if (!req.user.rollnumber) {
        return res.status(403).json({ success: false, message: "Only the student who filed a grievance can delete it." });
    }

    try {
        const { data: grievance, error: findError } = await supabase
            .from("Hostel_Grievances")
            .select("id")
            .eq("id", req.params.id)
            .eq("student_id", req.user.rollnumber)
            .maybeSingle();
        if (findError) throw findError;
        if (!grievance) return res.status(404).json({ success: false, message: "Grievance record not found." });

        // Staff progress notes hang off the grievance
        const { error: updatesError } = await supabase.from("grievance_updates").delete().eq("grievance_id", grievance.id);
        if (updatesError) throw updatesError;

        const { error } = await supabase.from("Hostel_Grievances").delete().eq("id", grievance.id);
        if (error) throw error;

        return res.status(200).json({ success: true, message: "Grievance deleted." });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Error deleting grievance." });
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