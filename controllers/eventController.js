import crypto from "crypto";
import supabase from "../config/Supabase.js";

// ==========================================
// 1. UPLOAD DATA & CREATE EVENT (Optimized)
// ==========================================
export const uploadEventData = async (req, res) => {
    const { event_name, start_time, end_time, applicants } = req.body;

    if (!event_name || !start_time || !end_time || !Array.isArray(applicants)) {
        return res.status(400).json({
            success: false,
            message: "event_name, start_time, end_time, and applicants array are required."
        });
    }

    try {
        // Generate a clean, short unique verification code
        const verificationCode = crypto.randomBytes(3).toString("hex").toUpperCase();

        const { data: eventData, error: eventError } = await supabase
            .from("event_details")
            .insert([
                {
                    event_name,
                    start_time,
                    end_time,
                    verification_code: verificationCode
                }
            ])
            .select()
            .single();

        if (eventError) throw eventError;

        const eventId = eventData.event_id;

        if (applicants.length > 0) {
            // FIX: Explicitly cast everything to String to match your TEXT column type perfectly
            const passRows = applicants.map((appId) => ({
                event_id: eventId,
                applicant_id: String(appId).trim(), 
                has_completed: false
            }));

            const { error: passError } = await supabase
                .from("event_passes")
                .insert(passRows);

            if (passError) throw passError;
        }

        return res.status(201).json({
            success: true,
            message: "Event created and applicant passes successfully populated.",
            event_id: eventId,
            verification_code: verificationCode
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Server Error processing data upload.",
            error: err.message
        });
    }
};

// ==========================================
// 2. APPROVE VERIFIER
// ==========================================
export const approveVerifier = async (req, res) => {
    const { verification_code } = req.body;

    if (!verification_code) {
        return res.status(400).json({
            success: false,
            message: "verification_code is required."
        });
    }

    try {
        const { data: event, error } = await supabase
            .from("event_details")
            .select("event_id, event_name")
            .eq("verification_code", verification_code.trim().toUpperCase())
            .maybeSingle();

        if (error) throw error;

        if (!event) {
            return res.status(401).json({
                success: false,
                message: "Invalid verification code. Access Denied."
            });
        }

        return res.status(200).json({
            success: true,
            message: `Approved successfully as a verifier for: ${event.event_name}`,
            event_id: event.event_id
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Server Error authorizing verifier.",
            error: err.message
        });
    }
};

// ==========================================
// 3. APPROVE APPLICANT
// ==========================================
export const approveApplicant = async (req, res) => {
    const { event_id, applicant_id } = req.body;

    if (!event_id || !applicant_id) {
        return res.status(400).json({
            success: false,
            message: "event_id and applicant_id are required."
        });
    }

    try {
        // FIX: Look up using String mapping to protect against input type differences
        const { data: pass, error: fetchError } = await supabase
            .from("event_passes")
            .select("*")
            .eq("event_id", event_id)
            .eq("applicant_id", String(applicant_id).trim())
            .maybeSingle();

        if (fetchError) throw fetchError;

        if (!pass) {
            return res.status(404).json({
                success: false,
                allowed: false,
                message: "Access Denied: Ticket entry invalid or not found for this event."
            });
        }

        if (pass.has_completed) {
            return res.status(403).json({
                success: false,
                allowed: false,
                message: "Access Denied: Ticket pass has already been checked out and used."
            });
        }

        const { error: updateError } = await supabase
            .from("event_passes")
            .update({ has_completed: true })
            .eq("event_id", event_id)
            .eq("applicant_id", String(applicant_id).trim());

        if (updateError) throw updateError;

        return res.status(200).json({
            success: true,
            allowed: true,
            message: "Access Granted: Check-in complete."
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Server Error verifying pass entry.",
            error: err.message
        });
    }
};

// ==========================================
// 4. GET ALL APPLICANT STATUS (Flexible)
// ==========================================
// export const getAllApplicantStatus = async (req, res) => {
//     // OPTIMIZATION: Accept via query OR request body to make frontend integration easier
//     const event_id = req.query.event_id || req.body.event_id;

//     if (!event_id) {
//         return res.status(400).json({
//             success: false,
//             message: "event_id is required as a query parameter or body variable."
//         });
//     }

//     try {
//         const { data: passes, error } = await supabase
//             .from("event_passes")
//             .select("applicant_id, has_completed")
//             .eq("event_id", event_id);

//         if (error) throw error;

//         return res.status(200).json({
//             success: true,
//             event_id,
//             total_applicants: passes.length,
//             applicants: passes
//         });

//     } catch (err) {
//         return res.status(500).json({
//             success: false,
//             message: "Server Error pulling verification tracking records.",
//             error: err.message
//         });
//     }
// };


// ==========================================
// 4. GET ALL APPLICANT STATUS (Bulletproof Version)
// ==========================================
export const getAllApplicantStatus = async (req, res) => {
    try {
        // Safe check: extract parameters safely even if req.query or req.body are missing
        const queryEventId = req.query ? req.query.event_id : null;
        const bodyEventId = req.body ? req.body.event_id : null;
        
        const event_id = queryEventId || bodyEventId;

        if (!event_id) {
            return res.status(400).json({
                success: false,
                message: "event_id is required as a query parameter or body variable."
            });
        }

        // Fetch tracking records matching this specific event UUID
        const { data: passes, error } = await supabase
            .from("event_passes")
            .select("applicant_id, has_completed")
            .eq("event_id", event_id);

        if (error) throw error;

        return res.status(200).json({
            success: true,
            event_id,
            total_applicants: passes.length,
            applicants: passes
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Server Error pulling verification tracking records.",
            error: err.message
        });
    }
};
