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
