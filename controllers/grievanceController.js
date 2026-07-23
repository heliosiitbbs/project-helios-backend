import supabase from "../config/Supabase.js";

// 1. GET ALL UNRESOLVED GRIEVANCES
export const getUnresolvedGrievances = async (req, res) => {
    try {
        const { data, error } = await supabase
           .from("Hostel_Grievances")// Adjust to your exact table name if different
            .select("*")
            .eq("is_resolved", false);

        if (error) throw error;

        return res.status(200).json({ success: true, count: data.length, grievances: data });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Error fetching unresolved grievances.", error: err.message });
    }
};

// 2. UPLOAD NEW GRIEVANCE (Student)
export const uploadGrievance = async (req, res) => {
    const { student_id, description, proof, grievance_type } = req.body;

    if (!student_id || !description) {
        return res.status(400).json({ success: false, message: "student_id and description are required fields." });
    }

    try {
        const { data, error } = await supabase
            .from("Hostel_Grievances")
            .insert([
                {
                    student_id,
                    description,
                    proof: proof || null,
                    "Grievance Type": grievance_type || null, // Handles space in your Supabase column name
                    is_resolved: false // Defaults to unresolved
                }
            ])
            .select()
            .single();

        if (error) throw error;

        return res.status(201).json({ success: true, message: "Grievance submitted successfully.", grievance: data });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Error uploading grievance.", error: err.message });
    }
};

// 3. ASSIGN GRIEVANCE (Admin)
export const assignGrievance = async (req, res) => {
    const { grievance_id, assigned_to } = req.body; // grievance_id maps to your 'id' column

    if (!grievance_id || !assigned_to) {
        return res.status(400).json({ success: false, message: "grievance_id and assigned_to are required." });
    }

    try {
        const { data, error } = await supabase
            .from("Hostel_Grievances")
            .update({ "assigned to": assigned_to }) // Handles space in 'assigned to' column
            .eq("id", grievance_id)
            .select()
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, message: "Grievance record not found." });

        return res.status(200).json({ success: true, message: `Grievance successfully assigned to ID: ${assigned_to}`, grievance: data });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Error assigning grievance.", error: err.message });
    }
};

// 4. MARK RESOLVED
export const markResolved = async (req, res) => {
    const { grievance_id } = req.body;

    if (!grievance_id) {
        return res.status(400).json({ success: false, message: "grievance_id is required." });
    }

    try {
        const { data, error } = await supabase
            .from("Hostel_Grievances")
            .update({ is_resolved: true })
            .eq("id", grievance_id)
            .select()
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, message: "Grievance record not found." });

        return res.status(200).json({ success: true, message: "Grievance marked as resolved.", grievance: data });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Error resolving grievance.", error: err.message });
    }
};

// 5. GET GRIEVANCE HISTORY BY STUDENT
export const getGrievanceHistory = async (req, res) => {
    const student_id = req.query.student_id || req.body.student_id;

    if (!student_id) {
        return res.status(400).json({ success: false, message: "student_id parameter is required." });
    }

    try {
        const { data, error } = await supabase
            .from("Hostel_Grievances")
            .select("*")
            .eq("student_id", student_id)
            .order("created_at", { ascending: false });

        if (error) throw error;

        return res.status(200).json({ success: true, count: data.length, history: data });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Error pulling grievance history.", error: err.message });
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
        return res.status(500).json({ success: false, message: "Error pulling all grievances.", error: err.message });
    }
};