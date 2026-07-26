import supabase from "../config/Supabase.js";

const MINUTES_PER_DAY = 24 * 60;

function pad(n) {
    return String(n).padStart(2, "0");
}

function formatMinutes(totalMinutes) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${pad(h)}:${pad(m)}:00`;
}

// Generates the fixed daily slot grid (e.g. 24 hourly slots) for a court -
// booked slots are filtered out against vault_bookings in getAvailableSlots.
function generateDailySlots(slotMinutes) {
    const slots = [];
    for (let start = 0; start + slotMinutes <= MINUTES_PER_DAY; start += slotMinutes) {
        slots.push({
            start_time: formatMinutes(start),
            end_time: formatMinutes(start + slotMinutes)
        });
    }
    return slots;
}

async function fetchResourceById(resource_id) {
    const { data, error } = await supabase
        .from("vault_resources")
        .select("*")
        .eq("resource_id", resource_id)
        .maybeSingle();

    if (error) throw error;
    return data;
}

// =====================================
// LIST RESOURCES (Items or Courts, with search)
// =====================================

export const listResources = async (req, res) => {
    const { type, search } = req.query;

    if (!type || !["item", "court"].includes(type)) {
        return res.status(400).json({ success: false, message: "type must be 'item' or 'court'." });
    }

    try {
        let query = supabase
            .from("vault_resources")
            .select("*")
            .eq("resource_type", type)
            .order("name", { ascending: true });

        if (search) {
            query = query.ilike("name", `%${search}%`);
        }

        const { data, error } = await query;
        if (error) throw error;

        return res.status(200).json({ success: true, count: data.length, resources: data });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Error fetching vault resources." });
    }
};

// =====================================
// GET RESOURCE DETAIL
// =====================================

export const getResource = async (req, res) => {
    try {
        const resource = await fetchResourceById(req.params.id);
        if (!resource) {
            return res.status(404).json({ success: false, message: "Resource not found." });
        }
        return res.status(200).json({ success: true, resource });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Error fetching resource." });
    }
};

// =====================================
// GET AVAILABLE COURT SLOTS FOR A DATE
// =====================================

export const getAvailableSlots = async (req, res) => {
    const { date } = req.query;

    if (!date) {
        return res.status(400).json({ success: false, message: "date query parameter is required (YYYY-MM-DD)." });
    }

    try {
        const resource = await fetchResourceById(req.params.id);
        if (!resource || resource.resource_type !== "court") {
            return res.status(404).json({ success: false, message: "Court not found." });
        }

        const { data: takenRows, error } = await supabase
            .from("vault_bookings")
            .select("start_time")
            .eq("resource_id", resource.resource_id)
            .eq("booking_date", date)
            .in("status", ["Pending", "Approved"]);

        if (error) throw error;

        const takenStartTimes = new Set(takenRows.map((r) => r.start_time));
        const allSlots = generateDailySlots(resource.slot_duration_minutes || 60);
        const availableSlots = allSlots.filter((s) => !takenStartTimes.has(s.start_time));

        return res.status(200).json({ success: true, date, slots: availableSlots });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Error fetching available slots." });
    }
};

// =====================================
// CREATE ITEM BOOKING
// =====================================

export const createItemBooking = async (req, res) => {
    const { resource_id, quantity } = req.body;
    const qty = Number(quantity);

    if (!resource_id || !qty || qty <= 0) {
        return res.status(400).json({ success: false, message: "resource_id and a positive quantity are required." });
    }

    try {
        const resource = await fetchResourceById(resource_id);
        if (!resource || resource.resource_type !== "item") {
            return res.status(404).json({ success: false, message: "Item not found." });
        }

        if (qty > resource.max_amount_per_request) {
            return res.status(400).json({
                success: false,
                message: `You can request at most ${resource.max_amount_per_request} of this item.`
            });
        }

        // Atomic check-and-decrement via a single UPDATE ... WHERE ... RETURNING
        // (wrapped as a Postgres function since PostgREST's plain .update() can't
        // express "available_count = available_count - qty" as a relative
        // expression). The WHERE clause is evaluated under the row lock this
        // UPDATE takes, so two concurrent requests against the last unit are
        // serialized by Postgres itself - no race is possible between the check
        // and the write, unlike the previous read-then-write version.
        const { data: reserveResult, error: reserveError } = await supabase.rpc("reserve_vault_item", {
            p_resource_id: resource_id,
            p_quantity: qty
        });

        if (reserveError) throw reserveError;

        if (!reserveResult || reserveResult.length === 0) {
            return res.status(409).json({ success: false, message: "Not enough units available right now." });
        }

        const requestedAt = new Date();
        const returnBy = new Date(requestedAt.getTime() + resource.allowed_time_to_keep_hours * 60 * 60 * 1000);

        const { data: booking, error: insertError } = await supabase
            .from("vault_bookings")
            .insert([
                {
                    resource_id,
                    user_id: req.user.id,
                    status: "Approved",
                    requested_at: requestedAt.toISOString(),
                    quantity: qty,
                    return_by: returnBy.toISOString()
                }
            ])
            .select()
            .single();

        if (insertError) {
            // The reservation succeeded but the booking row failed to write -
            // give the units back so they aren't stuck as permanently unavailable.
            const { error: rollbackError } = await supabase.rpc("release_vault_item", {
                p_resource_id: resource_id,
                p_quantity: qty
            });
            if (rollbackError) console.error("Failed to roll back vault reservation:", rollbackError);
            throw insertError;
        }

        return res.status(201).json({ success: true, message: "Item reserved successfully.", booking });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Error reserving item." });
    }
};

// =====================================
// GET MY ITEM BOOKINGS
// =====================================

export const getMyItemBookings = async (req, res) => {
    try {
        const { data: bookings, error } = await supabase
            .from("vault_bookings")
            .select("*")
            .eq("user_id", req.user.id)
            .not("quantity", "is", null)
            .order("requested_at", { ascending: false });

        if (error) throw error;

        const resourceIds = [...new Set(bookings.map((b) => b.resource_id))];
        let resourcesById = {};
        if (resourceIds.length > 0) {
            const { data: resources, error: resourceError } = await supabase
                .from("vault_resources")
                .select("resource_id, name")
                .in("resource_id", resourceIds);

            if (resourceError) throw resourceError;
            resourcesById = Object.fromEntries(resources.map((r) => [r.resource_id, r]));
        }

        const enriched = bookings.map((b) => ({
            ...b,
            item_name: resourcesById[b.resource_id]?.name || "Unknown item"
        }));

        return res.status(200).json({ success: true, count: enriched.length, bookings: enriched });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Error fetching your item bookings." });
    }
};

// =====================================
// CANCEL / RETURN ITEM BOOKING
// =====================================

export const cancelOrReturnItemBooking = async (req, res) => {
    try {
        const { data: booking, error } = await supabase
            .from("vault_bookings")
            .select("*")
            .eq("booking_id", req.params.id)
            .not("quantity", "is", null)
            .maybeSingle();

        if (error) throw error;
        if (!booking || booking.user_id !== req.user.id) {
            return res.status(404).json({ success: false, message: "Booking not found." });
        }

        if (!["Pending", "Approved"].includes(booking.status)) {
            return res.status(400).json({ success: false, message: "This booking can no longer be modified." });
        }

        const isReturning = booking.status === "Approved";
        const updates = isReturning
            ? { status: "Returned", returned_at: new Date().toISOString() }
            : { status: "Cancelled" };

        const { data: updatedBooking, error: updateError } = await supabase
            .from("vault_bookings")
            .update(updates)
            .eq("booking_id", booking.booking_id)
            .select()
            .single();

        if (updateError) throw updateError;

        if (isReturning) {
            // Same atomic-RPC approach as the reservation path, for the same reason.
            const { error: releaseError } = await supabase.rpc("release_vault_item", {
                p_resource_id: booking.resource_id,
                p_quantity: booking.quantity
            });
            if (releaseError) console.error("Failed to release vault reservation:", releaseError);
        }

        return res.status(200).json({ success: true, message: "Booking updated.", booking: updatedBooking });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Error updating booking." });
    }
};

// =====================================
// CREATE COURT BOOKING
// =====================================

export const createCourtBooking = async (req, res) => {
    const { resource_id, booking_date, start_time, end_time } = req.body;
    const companionIds = Array.isArray(req.body.companion_user_ids) ? req.body.companion_user_ids : [];

    if (!resource_id || !booking_date || !start_time || !end_time) {
        return res.status(400).json({
            success: false,
            message: "resource_id, booking_date, start_time and end_time are required."
        });
    }

    try {
        const resource = await fetchResourceById(resource_id);
        if (!resource || resource.resource_type !== "court") {
            return res.status(404).json({ success: false, message: "Court not found." });
        }

        const totalUsers = 1 + companionIds.length;
        if (totalUsers < resource.min_users) {
            return res.status(400).json({
                success: false,
                message: `This court needs at least ${resource.min_users} users (including you). Add ${resource.min_users - totalUsers} more companion(s).`
            });
        }

        const { data: booking, error: insertError } = await supabase
            .from("vault_bookings")
            .insert([
                {
                    resource_id,
                    user_id: req.user.id,
                    status: "Approved",
                    requested_at: new Date().toISOString(),
                    booking_date,
                    start_time,
                    end_time
                }
            ])
            .select()
            .single();

        if (insertError) {
            // Unique violation on (resource_id, booking_date, start_time) for active bookings
            if (insertError.code === "23505") {
                return res.status(409).json({ success: false, message: "That slot was just booked by someone else. Please pick another." });
            }
            throw insertError;
        }

        if (companionIds.length > 0) {
            const companionRows = companionIds.map((user_id) => ({ booking_id: booking.booking_id, user_id }));
            const { error: companionsError } = await supabase
                .from("vault_booking_companions")
                .insert(companionRows);

            if (companionsError) throw companionsError;
        }

        return res.status(201).json({
            success: true,
            message: "Court reserved successfully.",
            booking: { ...booking, companion_user_ids: companionIds }
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Error reserving court." });
    }
};

// =====================================
// GET MY COURT BOOKINGS
// =====================================

export const getMyCourtBookings = async (req, res) => {
    try {
        const { data: bookings, error } = await supabase
            .from("vault_bookings")
            .select("*")
            .eq("user_id", req.user.id)
            .not("start_time", "is", null)
            .order("booking_date", { ascending: false })
            .order("start_time", { ascending: false });

        if (error) throw error;

        const resourceIds = [...new Set(bookings.map((b) => b.resource_id))];
        let resourcesById = {};
        if (resourceIds.length > 0) {
            const { data: resources, error: resourceError } = await supabase
                .from("vault_resources")
                .select("resource_id, name, location")
                .in("resource_id", resourceIds);

            if (resourceError) throw resourceError;
            resourcesById = Object.fromEntries(resources.map((r) => [r.resource_id, r]));
        }

        const bookingIds = bookings.map((b) => b.booking_id);
        let companionsByBooking = {};
        if (bookingIds.length > 0) {
            const { data: companionRows, error: companionsError } = await supabase
                .from("vault_booking_companions")
                .select("booking_id, user_id")
                .in("booking_id", bookingIds);

            if (companionsError) throw companionsError;

            companionsByBooking = companionRows.reduce((acc, row) => {
                (acc[row.booking_id] ||= []).push(row.user_id);
                return acc;
            }, {});
        }

        const enriched = bookings.map((b) => ({
            ...b,
            court_name: resourcesById[b.resource_id]?.name || "Unknown court",
            location: resourcesById[b.resource_id]?.location || null,
            companion_user_ids: companionsByBooking[b.booking_id] || []
        }));

        return res.status(200).json({ success: true, count: enriched.length, bookings: enriched });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Error fetching your court bookings." });
    }
};

// =====================================
// CANCEL COURT BOOKING
// =====================================

export const cancelCourtBooking = async (req, res) => {
    try {
        const { data: booking, error } = await supabase
            .from("vault_bookings")
            .select("*")
            .eq("booking_id", req.params.id)
            .not("start_time", "is", null)
            .maybeSingle();

        if (error) throw error;
        if (!booking || booking.user_id !== req.user.id) {
            return res.status(404).json({ success: false, message: "Booking not found." });
        }

        if (!["Pending", "Approved"].includes(booking.status)) {
            return res.status(400).json({ success: false, message: "This booking can no longer be modified." });
        }

        const { data: updatedBooking, error: updateError } = await supabase
            .from("vault_bookings")
            .update({ status: "Cancelled" })
            .eq("booking_id", booking.booking_id)
            .select()
            .single();

        if (updateError) throw updateError;

        return res.status(200).json({ success: true, message: "Booking cancelled.", booking: updatedBooking });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Error cancelling booking." });
    }
};

// =====================================
// SEARCH USERS (for picking court companions)
// =====================================

export const searchUsers = async (req, res) => {
    const { query } = req.query;

    if (!query || query.trim().length < 2) {
        return res.status(200).json({ success: true, users: [] });
    }

    try {
        const { data, error } = await supabase
            .from("User_Details")
            .select(`id, "User Name", email_id`)
            .or(`"User Name".ilike.%${query}%,email_id.ilike.%${query}%`)
            .neq("id", req.user.id)
            .limit(10);

        if (error) throw error;

        const users = data.map((u) => ({ id: u.id, name: u["User Name"], email: u.email_id }));
        return res.status(200).json({ success: true, users });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Error searching users." });
    }
};
