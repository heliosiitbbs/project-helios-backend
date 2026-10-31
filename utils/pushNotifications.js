import supabase from "../config/Supabase.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// Every push shows as a heads-up banner at the top of the phone: the app creates
// this Android channel with high importance (src/notifications/pushRegistration.js).
// Without a channelId, Android uses Expo's default channel, which only puts the
// notification silently in the tray.
const PUSH_DEFAULTS = { channelId: "alerts", priority: "high", sound: "default" };

// Expo accepts up to 100 messages per request. Also prunes tokens that come
// back as "DeviceNotRegistered" (uninstalled app, etc.) so dead tokens don't
// pile up and get retried forever.
async function sendExpoPush(messages) {
    if (messages.length === 0) return;

    for (let i = 0; i < messages.length; i += 100) {
        const chunk = messages.slice(i, i + 100).map((m) => ({ ...PUSH_DEFAULTS, ...m }));

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

            // Surface delivery problems (e.g. InvalidCredentials when FCM isn't set
            // up for the Expo project) instead of failing silently
            if (result.errors) console.error("Expo push request rejected", JSON.stringify(result.errors));
            (result.data || []).forEach((entry) => {
                if (entry.status === "error" && entry.details?.error !== "DeviceNotRegistered") {
                    console.error("Expo push failed:", entry.details?.error || "", entry.message);
                }
            });

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

    for (let i = 0; i < rows.length; i += 1000) {
        const { error } = await supabase.from("notifications").insert(rows.slice(i, i + 1000));
        if (error) console.error("Failed to insert notification rows", error);
    }
}

// Which Notification Settings toggle (notification_preferences column) each push
// type falls under. A type not listed here is only silenced by the master switch.
const NOTIFICATION_CATEGORY = {
    grievance: "applied",
    lost_found: "applied",
    rides: "applied",
    bug: "applied",
    timetable: "applied",
    transport: "mess_transport",
    news: "oracle"
};

// Users who switched this type off. They still get the in-app feed row, just
// no push to their phone.
async function mutedUserIds(type) {
    const category = NOTIFICATION_CATEGORY[type];
    const filter = category ? `all_enabled.eq.false,${category}.eq.false` : "all_enabled.eq.false";
    const rows = await selectAll(() =>
        supabase.from("notification_preferences").select("user_id").or(filter).order("user_id")
    );
    return new Set(rows.map((r) => String(r.user_id)));
}

export async function sendPushToUserId(userId, { title, body, data, type }) {
    if (!userId) return;

    await insertNotificationRows([{ user_id: userId, type, title, body, data }]);

    if ((await mutedUserIds(type)).has(String(userId))) return;

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
    // Supabase returns at most 1000 rows per request, so page through everyone
    const users = await selectAll(() => supabase.from("User_Details").select("id").order("id"));
    if (!users.length) return;

    await insertNotificationRows(users.map((u) => ({ user_id: u.id, type, title, body, data })));

    const muted = await mutedUserIds(type);
    const tokens = (await selectAll(() => supabase.from("push_tokens").select("user_id, expo_push_token").order("expo_push_token")))
        .filter((t) => !muted.has(String(t.user_id)));

    if (tokens.length) {
        await sendExpoPush(tokens.map((t) => ({ to: t.expo_push_token, title, body, data })));
    }
}

async function selectAll(build) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) {
            console.error("Failed to load notification recipients", error);
            break;
        }
        rows.push(...data);
        if (data.length < 1000) break;
    }
    return rows;
}

// One notification per user, each with its own text: [{ userId, title, body, data, type }]
export async function sendPushToUsers(items) {
    const list = items.filter((i) => i.userId);
    if (list.length === 0) return;

    await insertNotificationRows(list.map(({ userId, type, title, body, data }) => ({ user_id: userId, type, title, body, data })));

    const byUser = new Map(list.map((i) => [String(i.userId), i]));
    const muted = await mutedUserIds(list[0].type);
    const ids = [...byUser.keys()].filter((id) => !muted.has(id));
    const tokens = [];
    for (let i = 0; i < ids.length; i += 300) {
        const { data } = await supabase.from("push_tokens").select("user_id, expo_push_token").in("user_id", ids.slice(i, i + 300));
        if (data) tokens.push(...data);
    }

    await sendExpoPush(tokens.map((t) => {
        const { title, body, data } = byUser.get(String(t.user_id));
        return { to: t.expo_push_token, title, body, data };
    }));
}

// "Fri, 10 Oct" for a YYYY-MM-DD date
export const formatDay = (isoDate) =>
    new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

// Today's date (YYYY-MM-DD) on campus, so past dates don't trigger notifications
export const todayOnCampus = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
