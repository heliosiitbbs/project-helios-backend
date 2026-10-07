import supabase from "../config/Supabase.js";
import { sendPushToUserId } from "../utils/pushNotifications.js";

const DESCRIPTION_LIMIT = 1000;

// =====================================
// REPORT A BUG (ANY SIGNED-IN USER)
// POST /api/bugs/report  (multipart: description, optional "screenshot")
// =====================================
export const createBugReport = async (req, res) => {
    try {
        const description = String(req.body.description || "").trim();

        if (!description) {
            return res.status(400).json({ success: false, message: "Please describe the bug." });
        }
        if (description.length > DESCRIPTION_LIMIT) {
            return res.status(400).json({ success: false, message: `Description must be at most ${DESCRIPTION_LIMIT} characters.` });
        }

        const { data: reporter, error: reporterError } = await supabase
            .from("User_Details")
            .select(`"User Name", email_id, "User Type"`)
            .eq("id", req.user.id)
            .maybeSingle();

        if (reporterError) throw reporterError;

        let screenshotUrl = null;
        if (req.file) {
            const fileExtension = req.file.originalname.split(".").pop();
            const filePath = `reports/${req.user.id}_${Date.now()}.${fileExtension}`;

            const { error: uploadError } = await supabase.storage
                .from("bug_reports")
                .upload(filePath, req.file.buffer, { contentType: req.file.mimetype });

            if (uploadError) {
                console.error(uploadError);
                return res.status(500).json({ success: false, message: "Error uploading screenshot" });
            }

            screenshotUrl = supabase.storage.from("bug_reports").getPublicUrl(filePath).data.publicUrl;
        }

        const { data, error } = await supabase
            .from("bug_reports")
            .insert([{
                user_id: req.user.id,
                reporter_name: reporter?.["User Name"] || null,
                reporter_email: reporter?.email_id || req.user.e_mail || null,
                reporter_type: reporter?.["User Type"] || req.user.user_type || null,
                description,
                screenshot_url: screenshotUrl
            }])
            .select()
            .single();

        if (error) throw error;

        return res.status(201).json({ success: true, message: "Bug reported. Thank you!", report: data });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// =====================================
// LIST BUG REPORTS (ADMIN)
// GET /api/bugs?status=open|resolved
// =====================================
export const getBugReports = async (req, res) => {
    try {
        const status = req.query.status === "resolved" ? "resolved" : "open";

        const { data, error } = await supabase
            .from("bug_reports")
            .select("*")
            .eq("status", status)
            .order(status === "resolved" ? "resolved_at" : "created_at", { ascending: false });

        if (error) throw error;

        return res.status(200).json({ success: true, reports: data });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// =====================================
// RESOLVE A BUG REPORT (ADMIN)
// PATCH /api/bugs/:id/resolve  { resolution }
// =====================================
export const resolveBugReport = async (req, res) => {
    try {
        const resolution = String(req.body.resolution || "").trim();
        if (!resolution) {
            return res.status(400).json({ success: false, message: "Enter the root cause and fix before resolving." });
        }

        const { data, error } = await supabase
            .from("bug_reports")
            .update({
                status: "resolved",
                resolution,
                resolved_at: new Date().toISOString(),
                resolved_by: req.user.id
            })
            .eq("id", req.params.id)
            .eq("status", "open")
            .select()
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            return res.status(404).json({ success: false, message: "Open bug report not found." });
        }

        if (data.user_id) {
            sendPushToUserId(data.user_id, {
                type: "bug",
                title: "Bug Report Resolved",
                body: `"${data.description.slice(0, 80)}" has been fixed. Thanks for reporting it!`,
                data: { screen: "Settings" }
            }).catch((err) => console.error("Failed to send bug resolution push", err));
        }

        return res.status(200).json({ success: true, message: "Bug report resolved", report: data });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};
