import supabase from "../config/Supabase.js";

// POST /api/notifications/register-token
// A token belongs to one device; re-registering (app reinstall, different
// user logging into the same device) just reassigns the existing row's
// user_id rather than creating a duplicate.
export const registerPushToken = async (req, res) => {
    try {
        const { token, platform } = req.body;

        if (!token) {
            return res.status(400).json({
                success: false,
                message: "token is required"
            });
        }

        const { error } = await supabase
            .from("push_tokens")
            .upsert(
                {
                    user_id: req.user.id,
                    expo_push_token: token,
                    platform,
                    updated_at: new Date().toISOString()
                },
                { onConflict: "expo_push_token" }
            );

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error registering push token"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Push token registered"
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// GET /api/notifications
export const getMyNotifications = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("notifications")
            .select("*")
            .eq("user_id", req.user.id)
            .order("created_at", { ascending: false });

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error fetching notifications"
            });
        }

        return res.status(200).json({ success: true, notifications: data });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// POST /api/notifications/clear  { ids: [] } - removes the caller's notifications they have just seen
export const clearNotifications = async (req, res) => {
    try {
        const { ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: "ids must be a non-empty array" });
        }

        const { error } = await supabase
            .from("notifications")
            .delete()
            .in("id", ids)
            .eq("user_id", req.user.id);

        if (error) {
            console.error(error);
            return res.status(500).json({ success: false, message: "Error clearing notifications" });
        }

        return res.status(200).json({ success: true, message: "Notifications cleared" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// DELETE /api/notifications/:id
export const dismissNotification = async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from("notifications")
            .delete()
            .eq("id", id)
            .eq("user_id", req.user.id)
            .select();

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error dismissing notification"
            });
        }

        if (!data?.length) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        return res.status(200).json({ success: true, message: "Notification dismissed" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

const PREFERENCE_FIELDS = ["all_enabled", "applied", "mess_transport", "oracle"];
const DEFAULT_PREFERENCES = { all_enabled: true, applied: true, mess_transport: true, oracle: true };

// GET /api/notifications/preferences - no row yet means everything is on
export const getNotificationPreferences = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("notification_preferences")
            .select(PREFERENCE_FIELDS.join(", "))
            .eq("user_id", req.user.id)
            .maybeSingle();

        if (error) {
            console.error(error);
            return res.status(500).json({ success: false, message: "Error fetching notification preferences" });
        }

        return res.status(200).json({ success: true, preferences: { ...DEFAULT_PREFERENCES, ...data } });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// PUT /api/notifications/preferences  { all_enabled?, applied?, mess_transport?, oracle? }
export const updateNotificationPreferences = async (req, res) => {
    try {
        const changes = {};
        for (const field of PREFERENCE_FIELDS) {
            if (field in req.body) {
                if (typeof req.body[field] !== "boolean") {
                    return res.status(400).json({ success: false, message: `${field} must be true or false` });
                }
                changes[field] = req.body[field];
            }
        }

        if (Object.keys(changes).length === 0) {
            return res.status(400).json({ success: false, message: "No preferences to update" });
        }

        const { data: existing } = await supabase
            .from("notification_preferences")
            .select(PREFERENCE_FIELDS.join(", "))
            .eq("user_id", req.user.id)
            .maybeSingle();

        const { data, error } = await supabase
            .from("notification_preferences")
            .upsert(
                {
                    ...DEFAULT_PREFERENCES,
                    ...existing,
                    ...changes,
                    user_id: req.user.id,
                    updated_at: new Date().toISOString()
                },
                { onConflict: "user_id" }
            )
            .select(PREFERENCE_FIELDS.join(", "))
            .single();

        if (error) {
            console.error(error);
            return res.status(500).json({ success: false, message: "Error updating notification preferences" });
        }

        return res.status(200).json({ success: true, preferences: data });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};
