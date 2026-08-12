import supabase from "../config/Supabase.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// Expo accepts up to 100 messages per request. Also prunes tokens that come
// back as "DeviceNotRegistered" (uninstalled app, etc.) so dead tokens don't
// pile up and get retried forever.
async function sendExpoPush(messages) {
    if (messages.length === 0) return;

    for (let i = 0; i < messages.length; i += 100) {
        const chunk = messages.slice(i, i + 100);

        try {
            const res = await fetch(EXPO_PUSH_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json"
                },
                body: JSON.stringify(chunk)
            });

            const result = await res.json();

            const invalidTokens = (result.data || [])
                .map((entry, idx) =>
                    entry.status === "error" && entry.details?.error === "DeviceNotRegistered"
                        ? chunk[idx].to
                        : null
                )
                .filter(Boolean);

            if (invalidTokens.length > 0) {
                await supabase.from("push_tokens").delete().in("expo_push_token", invalidTokens);
            }
        } catch (err) {
            console.error("Expo push send failed", err);
        }
    }
}

// Every notification also gets a row here so the in-app Notifications page
// (swipe-to-dismiss feed) has something to show, independent of whether the
// device has push permission/a registered token.
async function insertNotificationRows(rows) {
    if (rows.length === 0) return;

    const { error } = await supabase.from("notifications").insert(rows);
    if (error) console.error("Failed to insert notification rows", error);
}

export async function sendPushToUserId(userId, { title, body, data, type }) {
    if (!userId) return;

    await insertNotificationRows([{ user_id: userId, type, title, body, data }]);

    const { data: tokens } = await supabase
        .from("push_tokens")
        .select("expo_push_token")
        .eq("user_id", userId);

    if (tokens?.length) {
        await sendExpoPush(tokens.map((t) => ({ to: t.expo_push_token, title, body, data })));
    }
}

export async function sendPushToEmail(email, payload) {
    if (!email) return;

    const { data: user } = await supabase
        .from("User_Details")
        .select("id")
        .eq("email_id", email)
        .maybeSingle();

    if (!user) return;

    await sendPushToUserId(user.id, payload);
}

export async function sendPushToRollNumber(rollNumber, payload) {
    if (!rollNumber) return;

    const { data: student } = await supabase
        .from("Student_Details")
        .select("User_code")
        .eq("Roll Number", rollNumber)
        .maybeSingle();

    if (!student) return;

    await sendPushToUserId(student.User_code, payload);
}

export async function sendPushToAll({ title, body, data, type }) {
    const { data: users, error: usersError } = await supabase.from("User_Details").select("id");

    if (usersError || !users?.length) return;

    await insertNotificationRows(users.map((u) => ({ user_id: u.id, type, title, body, data })));

    const { data: tokens } = await supabase.from("push_tokens").select("expo_push_token");

    if (tokens?.length) {
        await sendExpoPush(tokens.map((t) => ({ to: t.expo_push_token, title, body, data })));
    }
}
