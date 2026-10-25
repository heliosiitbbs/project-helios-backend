import supabase from "../config/Supabase.js";

// Why a visitor can't use the app right now (visit not started yet, or already over), or null.
// A read error lets the request through: the account's own expiry_date still ends access.
export const visitorAccessMessage = async (user, now = new Date()) => {
    if (user["User Type"] !== "Visitor") return null;
    if (user.expiry_date && new Date(user.expiry_date) <= now) return "Your visit has ended.";
    const { data, error } = await supabase
        .from("Visitor_Details")
        .select("entry_start")
        .eq("user_id", user.id)
        .maybeSingle();
    if (error) {
        console.error("Visitor_Details lookup failed:", error.message);
        return null;
    }
    if (data && new Date(data.entry_start) > now) {
        return `Your visit starts on ${new Date(data.entry_start).toDateString()}. You can use the app from then.`;
    }
    return null;
};
