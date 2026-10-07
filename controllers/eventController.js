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
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error processing data upload."});
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
            return res.status(403).json({
                success: false,
                message: "Invalid verification code. Access Denied."
            });
        }

        return res.status(200).json({
            success: true,
            message: `Approved successfully as a verifier for: ${event.event_name}`,
            event_id: event.event_id,
            event_name: event.event_name
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error authorizing verifier."});
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
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error verifying pass entry."});
    }
};

// ==========================================
// 4. GET ALL APPLICANT STATUS (Admin/organizer roster view)
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
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error pulling verification tracking records."});
    }
};

// ==========================================
// 5. GET MY EVENT PASSES (Student self-serve)
// ==========================================
// Note: applicant_id is a free-text field set by whoever calls upload-data,
// so it isn't guaranteed to be any one identity field - match against every
// identity value this user's token carries.
export const getMyEventPasses = async (req, res) => {
    try {
        const identityCandidates = [
            req.user.id,
            req.user.e_mail,
            req.user.rollnumber
        ]
            .filter(Boolean)
            .map(String);

        const { data: passes, error } = await supabase
            .from("event_passes")
            .select("id, event_id, applicant_id, has_completed")
            .in("applicant_id", identityCandidates);

        if (error) throw error;

        const eventIds = [...new Set(passes.map((p) => p.event_id))];

        let eventsById = {};
        if (eventIds.length > 0) {
            const { data: events, error: eventsError } = await supabase
                .from("event_details")
                .select("event_id, event_name, start_time, end_time")
                .in("event_id", eventIds);

            if (eventsError) throw eventsError;

            eventsById = Object.fromEntries(events.map((e) => [e.event_id, e]));
        }

        const enrichedPasses = passes.map((p) => ({
            ...p,
            event_name: eventsById[p.event_id]?.event_name || null,
            start_time: eventsById[p.event_id]?.start_time || null,
            end_time: eventsById[p.event_id]?.end_time || null
        }));

        return res.status(200).json({
            success: true,
            passes: enrichedPasses
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error pulling your event passes."});
    }
};

// ==========================================
// 6. SCAN PASS (door staff scanning a student's pass QR)
// ==========================================
// Gated by the event's verification_code, like approve-verifier. The pass is
// marked used with a single conditional update, so two scanners can never both
// accept the same pass.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const scanPass = async (req, res) => {
    const verification_code = String(req.body.verification_code || "").trim().toUpperCase();
    const pass_id = String(req.body.pass_id || "").trim();

    if (!verification_code || !pass_id) {
        return res.status(400).json({
            success: false,
            message: "verification_code and pass_id are required."
        });
    }

    if (!UUID_PATTERN.test(pass_id)) {
        return res.status(400).json({
            success: false,
            allowed: false,
            message: "This is not a valid Helios event pass."
        });
    }

    try {
        const { data: event, error: eventError } = await supabase
            .from("event_details")
            .select("event_id, event_name, end_time")
            .eq("verification_code", verification_code)
            .maybeSingle();

        if (eventError) throw eventError;

        if (!event) {
            return res.status(403).json({
                success: false,
                message: "Invalid verification code. Access Denied."
            });
        }

        if (event.end_time && new Date(event.end_time) < new Date()) {
            return res.status(403).json({
                success: false,
                allowed: false,
                message: `Access Denied: ${event.event_name} has ended.`
            });
        }

        // Only flips an unused pass that belongs to this event
        const { data: used, error: updateError } = await supabase
            .from("event_passes")
            .update({ has_completed: true })
            .eq("id", pass_id)
            .eq("event_id", event.event_id)
            .eq("has_completed", false)
            .select("id, applicant_id")
            .maybeSingle();

        if (updateError) throw updateError;

        if (used) {
            return res.status(200).json({
                success: true,
                allowed: true,
                message: "Access Granted: pass checked in.",
                applicant_id: used.applicant_id,
                event_name: event.event_name
            });
        }

        // Nothing was updated - work out why
        const { data: pass, error: fetchError } = await supabase
            .from("event_passes")
            .select("event_id, has_completed")
            .eq("id", pass_id)
            .maybeSingle();

        if (fetchError) throw fetchError;

        if (!pass || pass.event_id !== event.event_id) {
            return res.status(404).json({
                success: false,
                allowed: false,
                message: `Access Denied: this pass is not for ${event.event_name}.`
            });
        }

        return res.status(409).json({
            success: false,
            allowed: false,
            message: "Access Denied: this pass has already been used."
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error scanning pass."});
    }
};
