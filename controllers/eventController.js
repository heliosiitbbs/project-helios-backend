import crypto from "crypto";
import xlsx from "xlsx";
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

// ==========================================
// ADMIN DASHBOARD: EVENTS & PASS ISSUING
// ==========================================

const ROLL_PATTERN = /^\d{2}[A-Z]{2}\d{4,6}$/; // e.g. 22CS01031
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Turns raw entries (roll numbers or emails, any case/spacing) into the exact
// identifiers my-passes looks up: the student's "Roll Number" as stored, or the
// account's email. Anything that matches no account is returned in `unmatched`
// instead of becoming a pass nobody can ever see.
const resolveApplicants = async (rawList) => {
    const cleaned = [...new Set(rawList.map((v) => String(v ?? "").trim()).filter(Boolean))];

    const rolls = cleaned.filter((v) => !v.includes("@")).map((v) => v.toUpperCase());
    const emails = cleaned.filter((v) => v.includes("@")).map((v) => v.toLowerCase());

    const knownRolls = new Set();
    const knownEmails = new Set();

    for (let i = 0; i < rolls.length; i += 500) {
        const { data, error } = await supabase
            .from("Student_Details")
            .select(`"Roll Number"`)
            .in("Roll Number", rolls.slice(i, i + 500));
        if (error) throw error;
        data.forEach((r) => knownRolls.add(r["Roll Number"]));
    }

    for (let i = 0; i < emails.length; i += 500) {
        const { data, error } = await supabase
            .from("User_Details")
            .select("email_id")
            .in("email_id", emails.slice(i, i + 500));
        if (error) throw error;
        data.forEach((u) => knownEmails.add(u.email_id));
    }

    const matched = [];
    const unmatched = [];
    for (const raw of cleaned) {
        const id = raw.includes("@") ? raw.toLowerCase() : raw.toUpperCase();
        if (knownRolls.has(id) || knownEmails.has(id)) {
            if (!matched.includes(id)) matched.push(id);
        } else {
            unmatched.push(raw);
        }
    }
    return { matched, unmatched };
};

// Inserts passes for already-resolved identifiers, skipping anyone who has one
const insertPasses = async (eventId, ids) => {
    const { data: existing, error } = await supabase
        .from("event_passes")
        .select("applicant_id")
        .eq("event_id", eventId);
    if (error) throw error;

    const have = new Set(existing.map((p) => p.applicant_id));
    const fresh = ids.filter((id) => !have.has(id));

    if (fresh.length > 0) {
        const { error: insertError } = await supabase
            .from("event_passes")
            .insert(fresh.map((applicant_id) => ({ event_id: eventId, applicant_id, has_completed: false })));
        if (insertError) throw insertError;
    }
    return { added: fresh.length, alreadyHad: ids.length - fresh.length };
};

// GET /api/events - every event with pass counts
export const listEvents = async (req, res) => {
    try {
        const { data: events, error } = await supabase
            .from("event_details")
            .select("event_id, event_name, start_time, end_time, verification_code, created_at")
            .order("start_time", { ascending: false });
        if (error) throw error;

        const { data: passes, error: passError } = await supabase
            .from("event_passes")
            .select("event_id, has_completed");
        if (passError) throw passError;

        const counts = {};
        passes.forEach((p) => {
            const c = (counts[p.event_id] ||= { total: 0, used: 0 });
            c.total++;
            if (p.has_completed) c.used++;
        });

        return res.status(200).json({
            success: true,
            events: events.map((e) => ({
                ...e,
                total_passes: counts[e.event_id]?.total || 0,
                used_passes: counts[e.event_id]?.used || 0
            }))
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error loading events." });
    }
};

// POST /api/events/create  { event_name, start_time, end_time, applicants: [] }
export const createEventWithPasses = async (req, res) => {
    try {
        const event_name = String(req.body.event_name || "").trim();
        const { start_time, end_time } = req.body;
        const applicants = Array.isArray(req.body.applicants) ? req.body.applicants : [];

        if (!event_name || !start_time || !end_time) {
            return res.status(400).json({ success: false, message: "Event name, valid from and valid upto are required." });
        }

        const start = new Date(start_time);
        const end = new Date(end_time);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            return res.status(400).json({ success: false, message: "Valid from and valid upto must be valid dates." });
        }
        if (end <= start) {
            return res.status(400).json({ success: false, message: "Valid upto must be after valid from." });
        }

        const { matched, unmatched } = await resolveApplicants(applicants);

        const { data: event, error } = await supabase
            .from("event_details")
            .insert([{
                event_name,
                start_time: start.toISOString(),
                end_time: end.toISOString(),
                verification_code: crypto.randomBytes(3).toString("hex").toUpperCase()
            }])
            .select()
            .single();
        if (error) throw error;

        const { added } = await insertPasses(event.event_id, matched);

        return res.status(201).json({
            success: true,
            message: `Event created with ${added} pass${added === 1 ? "" : "es"}.`,
            event: { ...event, total_passes: added, used_passes: 0 },
            added,
            unmatched
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error creating event." });
    }
};

// GET /api/events/:eventId/passes - attendee list for one event
export const getEventPasses = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("event_passes")
            .select("id, applicant_id, has_completed, created_at")
            .eq("event_id", req.params.eventId)
            .order("created_at", { ascending: true });
        if (error) throw error;

        return res.status(200).json({ success: true, passes: data });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error loading passes." });
    }
};

// POST /api/events/:eventId/passes  { applicants: [] } - add attendees to an existing event
export const addEventPasses = async (req, res) => {
    try {
        const applicants = Array.isArray(req.body.applicants) ? req.body.applicants : [];
        if (applicants.length === 0) {
            return res.status(400).json({ success: false, message: "Add at least one roll number or email." });
        }

        const { data: event, error } = await supabase
            .from("event_details")
            .select("event_id")
            .eq("event_id", req.params.eventId)
            .maybeSingle();
        if (error) throw error;
        if (!event) return res.status(404).json({ success: false, message: "Event not found." });

        const { matched, unmatched } = await resolveApplicants(applicants);
        const { added, alreadyHad } = await insertPasses(event.event_id, matched);

        return res.status(200).json({
            success: true,
            message: `Added ${added} pass${added === 1 ? "" : "es"}${alreadyHad ? ` (${alreadyHad} already had one)` : ""}.`,
            added,
            alreadyHad,
            unmatched
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error adding passes." });
    }
};

// DELETE /api/events/passes/:passId - revoke a pass that hasn't been used
export const revokePass = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("event_passes")
            .delete()
            .eq("id", req.params.passId)
            .eq("has_completed", false)
            .select("id");
        if (error) throw error;

        if (!data || data.length === 0) {
            return res.status(409).json({ success: false, message: "Pass not found or already used - used passes can't be revoked." });
        }
        return res.status(200).json({ success: true, message: "Pass revoked." });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error revoking pass." });
    }
};

// POST /api/events/parse-applicants  (multipart "file": .xlsx/.xls/.csv)
// Pulls every roll number or email out of the sheet (any column, any row) so
// the dashboard can preview and confirm before issuing passes.
export const parseApplicantsFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Upload an Excel or CSV file." });
        }

        const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
        const found = new Set();
        let cellsChecked = 0;

        for (const sheetName of workbook.SheetNames) {
            const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
            for (const row of rows) {
                for (const cell of row) {
                    const value = String(cell ?? "").trim();
                    if (!value) continue;
                    cellsChecked++;
                    if (EMAIL_PATTERN.test(value)) found.add(value.toLowerCase());
                    else if (ROLL_PATTERN.test(value.toUpperCase())) found.add(value.toUpperCase());
                }
            }
        }

        if (found.size === 0) {
            return res.status(400).json({
                success: false,
                message: "No roll numbers or emails found in this file. Put one per cell, e.g. 22CS01031 or name@iitbbs.ac.in."
            });
        }

        return res.status(200).json({ success: true, applicants: [...found], cellsChecked });
    } catch (err) {
        console.error(err);
        return res.status(400).json({ success: false, message: "Couldn't read this file. Make sure it's a valid Excel or CSV file." });
    }
};
