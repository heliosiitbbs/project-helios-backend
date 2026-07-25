import supabase from "../config/Supabase.js";

// No documented convention existed for this column (no CHECK constraint, no
// existing rows) - using the standard 0/1/2 scheme, matching what both the
// history and apply pages expect to display.
const STATUS_LABELS = {
    0: "Pending",
    1: "Approved",
    2: "Rejected"
};

function labelStatus(row) {
    return {
        ...row,
        status_label: STATUS_LABELS[row["status of application"]] || "Pending"
    };
}

async function uploadProof(file, safeId) {
    const fileExtension = file.originalname.split(".").pop();
    const filePath = `${safeId}_${Date.now()}.${fileExtension}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
        .from("leave_proofs")
        .upload(filePath, file.buffer, {
            contentType: file.mimetype
        });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
        .from("leave_proofs")
        .getPublicUrl(uploadData.path);

    return publicUrlData.publicUrl;
}

// =====================================
// APPLY FOR LEAVE
// =====================================

export const applyForLeave = async (req, res) => {
    try {
        const { start_date, end_date, reason } = req.body;

        if (!start_date || !end_date || !reason) {
            return res.status(400).json({
                success: false,
                message: "start_date, end_date and reason are required."
            });
        }

        // student_id is a foreign key to Student_Details."Roll Number"
        const student_id = req.user.rollnumber;

        if (!student_id) {
            return res.status(400).json({
                success: false,
                message: "Only students can apply for leave."
            });
        }

        let proof = null;
        if (req.file) {
            const safeId = String(student_id).replace(/[^a-zA-Z0-9]/g, "_");
            proof = await uploadProof(req.file, safeId);
        }

        const { data, error } = await supabase
            .from("Leave_Application")
            .insert([
                {
                    student_id,
                    start_date: start_date.slice(0, 10),
                    end_date: end_date.slice(0, 10),
                    reason,
                    proof,
                    "status of application": 0
                }
            ])
            .select()
            .single();

        if (error) throw error;

        return res.status(201).json({
            success: true,
            message: "Leave application submitted successfully.",
            application: labelStatus(data)
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Error submitting leave application."
        });
    }
};

// =====================================
// GET MY LEAVE APPLICATIONS
// =====================================

export const getMyLeaveApplications = async (req, res) => {
    try {
        const student_id = req.user.rollnumber;

        if (!student_id) {
            return res.status(200).json({ success: true, count: 0, applications: [] });
        }

        const { data, error } = await supabase
            .from("Leave_Application")
            .select("*")
            .eq("student_id", student_id)
            .order("created_at", { ascending: false });

        if (error) throw error;

        return res.status(200).json({
            success: true,
            count: data.length,
            applications: data.map(labelStatus)
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Error fetching your leave applications."
        });
    }
};
