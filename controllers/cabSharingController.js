import supabase from "../config/Supabase.js";
import { sendPushToUserId, sendPushToUsers } from "../utils/pushNotifications.js";

// Cab sharing between students.
//  - cab_sharing_rides: one row per ride a student hosts (seats_total includes the host)
//  - cab_sharing_members: everyone else's relation to a ride. A rider asks to join
//    ("requested"), the host confirms or declines; a confirmed rider can leave.
// Seats left are always counted from confirmed members, never stored.

const VEHICLES = ["cab", "auto"];
const NOTES_LIMIT = 180;

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const serverError = (res, err) => {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
};

const categoryOf = (ride) => {
    const text = `${ride.origin} ${ride.destination}`.toLowerCase();
    if (/airport|bbi/.test(text)) return "airport";
    if (/station|railway|rly|junction|khurda/.test(text)) return "station";
    return "other";
};

const whenText = (iso) =>
    new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// User_Details + Student_Details for a set of user ids
const loadPeople = async (ids) => {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return new Map();
    const { data, error } = await supabase
        .from("User_Details")
        .select('id, "User Name", display_name, phone_number, photoUrl, Student_Details("Roll Number", Hostel_Details, "Room No")')
        .in("id", list);
    if (error) throw error;
    return new Map(data.map((u) => {
        const st = Array.isArray(u.Student_Details) ? u.Student_Details[0] : u.Student_Details;
        return [u.id, {
            id: u.id,
            name: u.display_name || u["User Name"] || "Student",
            full_name: u["User Name"] || "",
            phone: u.phone_number || "",
            photo: u.photoUrl || null,
            roll_number: st?.["Roll Number"] || "",
            hostel: st?.Hostel_Details || "",
            room: st?.["Room No"] || ""
        }];
    }));
};

const loadMembers = async (rideIds) => {
    if (!rideIds.length) return [];
    const { data, error } = await supabase.from("cab_sharing_members").select("*").in("ride_id", rideIds);
    if (error) throw error;
    return data;
};

// Shape rides for the app. `detail` adds the member list (and contact numbers where allowed).
const shapeRides = async (rides, viewerId, { detail = false } = {}) => {
    const members = await loadMembers(rides.map((r) => r.id));
    const people = await loadPeople([...rides.map((r) => r.host_id), ...(detail ? members.map((m) => m.user_id) : [])]);
    const now = Date.now();

    return rides.map((ride) => {
        const mine = members.filter((m) => m.ride_id === ride.id);
        const confirmed = mine.filter((m) => m.status === "confirmed");
        const riders = confirmed.length + 1; // + host
        const isHost = ride.host_id === viewerId;
        const myMembership = mine.find((m) => m.user_id === viewerId);
        const myStatus = isHost ? "host" : myMembership?.status || null;
        const inRide = isHost || myStatus === "confirmed";
        const host = people.get(ride.host_id) || { id: ride.host_id, name: "Student" };
        const fare = ride.total_fare !== null && ride.total_fare !== undefined ? Number(ride.total_fare) : null;

        const shaped = {
            id: ride.id,
            origin: ride.origin,
            destination: ride.destination,
            category: categoryOf(ride),
            depart_from: ride.depart_from,
            depart_until: ride.depart_until,
            vehicle_type: ride.vehicle_type,
            seats_total: ride.seats_total,
            seats_taken: riders,
            seats_left: Math.max(ride.seats_total - riders, 0),
            total_fare: fare,
            share_now: fare !== null ? Math.ceil(fare / riders) : null,
            share_full: fare !== null ? Math.ceil(fare / ride.seats_total) : null,
            notes: ride.notes || "",
            status: ride.status === "cancelled" ? "cancelled" : new Date(ride.depart_until).getTime() < now ? "completed" : "active",
            created_at: ride.created_at,
            my_status: myStatus,
            pending_requests: isHost ? mine.filter((m) => m.status === "requested").length : 0,
            // Anyone may contact the host to ask about the ride
            host: { id: host.id, name: host.name, full_name: host.full_name, photo: host.photo, hostel: host.hostel, roll_number: host.roll_number, phone: host.phone || "" }
        };

        if (detail) {
            const person = (m) => people.get(m.user_id) || { id: m.user_id, name: "Student" };
            shaped.members = confirmed.map((m) => {
                const p = person(m);
                // Riders in the same cab can see each other's numbers; others only see names
                return { member_id: m.id, id: p.id, name: p.name, photo: p.photo, hostel: p.hostel, room: p.room, roll_number: p.roll_number, phone: inRide ? p.phone : "" };
            });
            shaped.requests = isHost
                ? mine.filter((m) => m.status === "requested").map((m) => {
                    const p = person(m);
                    return { member_id: m.id, id: p.id, name: p.name, photo: p.photo, hostel: p.hostel, roll_number: p.roll_number, phone: p.phone, requested_at: m.created_at };
                })
                : [];
        }
        return shaped;
    });
};

const findRide = async (id) => {
    const { data, error } = await supabase.from("cab_sharing_rides").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
};

const confirmedCount = async (rideId) => {
    const { count, error } = await supabase
        .from("cab_sharing_members")
        .select("id", { count: "exact", head: true })
        .eq("ride_id", rideId)
        .eq("status", "confirmed");
    if (error) throw error;
    return count || 0;
};

const notify = (userId, title, body, rideId) => {
    sendPushToUserId(userId, { type: "rides", title, body, data: { screen: "RideDetail", rideId } })
        .catch((err) => console.error("Failed to send ride push", err));
};

const routeText = (ride) => `${ride.origin} → ${ride.destination}`;

// GET /api/cab-sharing/rides?category=airport|station|other|all
// Upcoming, open rides from everyone
export const getAllRides = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("cab_sharing_rides")
            .select("*")
            .eq("status", "active")
            .gte("depart_until", new Date().toISOString())
            .order("depart_from", { ascending: true })
            .limit(200);
        if (error) throw error;

        let rides = await shapeRides(data, req.user.id);
        const { category } = req.query;
        if (category && category !== "all") rides = rides.filter((r) => r.category === category);
        return res.status(200).json({ success: true, count: rides.length, rides });
    } catch (err) {
        return serverError(res, err);
    }
};

// GET /api/cab-sharing/my-rides -> rides I host or have asked to join / joined
export const getMyRides = async (req, res) => {
    try {
        const userId = req.user.id;
        const { data: memberships, error: e1 } = await supabase
            .from("cab_sharing_members")
            .select("ride_id, status")
            .eq("user_id", userId)
            .in("status", ["requested", "confirmed"]);
        if (e1) throw e1;

        const ids = memberships.map((m) => m.ride_id);
        const { data: hosted, error: e2 } = await supabase.from("cab_sharing_rides").select("*").eq("host_id", userId);
        if (e2) throw e2;
        const { data: joined, error: e3 } = ids.length
            ? await supabase.from("cab_sharing_rides").select("*").in("id", ids)
            : { data: [], error: null };
        if (e3) throw e3;

        const all = [...new Map([...hosted, ...joined].map((r) => [r.id, r])).values()];
        const rides = (await shapeRides(all, userId)).sort((a, b) => new Date(b.depart_from) - new Date(a.depart_from));
        return res.status(200).json({
            success: true,
            upcoming: rides.filter((r) => r.status === "active").reverse(),
            past: rides.filter((r) => r.status !== "active")
        });
    } catch (err) {
        return serverError(res, err);
    }
};

// GET /api/cab-sharing/rides/:id
export const getRide = async (req, res) => {
    try {
        const ride = await findRide(req.params.id);
        if (!ride) return fail(res, 404, "Ride not found");
        const [shaped] = await shapeRides([ride], req.user.id, { detail: true });
        return res.status(200).json({ success: true, ride: shaped });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /api/cab-sharing/rides
// { origin, destination, depart_from, depart_until, vehicle_type, seats_total, total_fare, notes }
export const createRide = async (req, res) => {
    try {
        const b = req.body || {};
        const origin = String(b.origin || "").trim();
        const destination = String(b.destination || "").trim();
        const from = new Date(b.depart_from);
        const until = new Date(b.depart_until || b.depart_from);
        const seats = Number(b.seats_total);
        const vehicle = VEHICLES.includes(b.vehicle_type) ? b.vehicle_type : "cab";
        const fare = b.total_fare === undefined || b.total_fare === null || b.total_fare === "" ? null : Number(b.total_fare);
        const notes = String(b.notes || "").trim();

        if (origin.length < 2 || destination.length < 2) return fail(res, 400, "Enter where the ride starts and ends");
        if (origin.toLowerCase() === destination.toLowerCase()) return fail(res, 400, "Start and destination can't be the same");
        if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime())) return fail(res, 400, "Choose a departure time");
        if (until < from) return fail(res, 400, "The latest departure must be after the earliest");
        if (until.getTime() - from.getTime() > 12 * 3600 * 1000) return fail(res, 400, "Keep the departure window under 12 hours");
        if (until.getTime() < Date.now()) return fail(res, 400, "That time has already passed");
        if (!Number.isInteger(seats) || seats < 2 || seats > 7) return fail(res, 400, "Total seats must be between 2 and 7 (including you)");
        if (fare !== null && (!Number.isFinite(fare) || fare < 0 || fare > 100000)) return fail(res, 400, "Enter a valid fare");
        if (notes.length > NOTES_LIMIT) return fail(res, 400, `Notes can be at most ${NOTES_LIMIT} characters`);

        const { data, error } = await supabase
            .from("cab_sharing_rides")
            .insert([{
                host_id: req.user.id,
                origin: origin.slice(0, 80),
                destination: destination.slice(0, 80),
                depart_from: from.toISOString(),
                depart_until: until.toISOString(),
                vehicle_type: vehicle,
                seats_total: seats,
                total_fare: fare,
                notes: notes || null
            }])
            .select()
            .single();
        if (error) throw error;

        const [ride] = await shapeRides([data], req.user.id, { detail: true });
        return res.status(201).json({ success: true, message: "Ride posted", ride });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /api/cab-sharing/rides/:id/join -> ask the host for a seat
export const joinRide = async (req, res) => {
    try {
        const userId = req.user.id;
        const ride = await findRide(req.params.id);
        if (!ride) return fail(res, 404, "Ride not found");
        if (ride.status !== "active" || new Date(ride.depart_until).getTime() < Date.now()) return fail(res, 400, "This ride is no longer open");
        if (ride.host_id === userId) return fail(res, 400, "You're hosting this ride");
        if (ride.seats_total - 1 - (await confirmedCount(ride.id)) <= 0) return fail(res, 400, "This ride is full");

        const { data: existing, error: e1 } = await supabase
            .from("cab_sharing_members")
            .select("*")
            .eq("ride_id", ride.id)
            .eq("user_id", userId)
            .maybeSingle();
        if (e1) throw e1;
        if (existing?.status === "confirmed") return fail(res, 400, "You're already in this ride");
        if (existing?.status === "requested") return fail(res, 400, "You've already asked to join");
        if (existing?.status === "declined") return fail(res, 400, "The host declined your request for this ride");

        const { error } = existing
            ? await supabase.from("cab_sharing_members").update({ status: "requested", responded_at: null, created_at: new Date().toISOString() }).eq("id", existing.id)
            : await supabase.from("cab_sharing_members").insert([{ ride_id: ride.id, user_id: userId }]);
        if (error) throw error;

        const me = (await loadPeople([userId])).get(userId);
        notify(ride.host_id, "New ride request", `${me?.name || "A student"}${me?.hostel ? ` (${me.hostel})` : ""} wants to join your ride ${routeText(ride)} on ${whenText(ride.depart_from)}.`, ride.id);

        const [shaped] = await shapeRides([ride], userId, { detail: true });
        return res.status(200).json({ success: true, message: "Request sent to the host", ride: shaped });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /api/cab-sharing/rides/:id/requests/:memberId { action: "accept" | "decline" } (host only)
export const respondToRequest = async (req, res) => {
    try {
        const action = req.body?.action;
        if (!["accept", "decline"].includes(action)) return fail(res, 400, "action must be accept or decline");
        const ride = await findRide(req.params.id);
        if (!ride) return fail(res, 404, "Ride not found");
        if (ride.host_id !== req.user.id) return fail(res, 403, "Only the host can answer requests");
        if (ride.status !== "active") return fail(res, 400, "This ride is no longer open");

        const { data: member, error: e1 } = await supabase
            .from("cab_sharing_members")
            .select("*")
            .eq("id", req.params.memberId)
            .eq("ride_id", ride.id)
            .maybeSingle();
        if (e1) throw e1;
        if (!member || member.status !== "requested") return fail(res, 404, "Request not found");
        if (action === "accept" && ride.seats_total - 1 - (await confirmedCount(ride.id)) <= 0) return fail(res, 400, "No seats left — the ride is full");

        const { error } = await supabase
            .from("cab_sharing_members")
            .update({ status: action === "accept" ? "confirmed" : "declined", responded_at: new Date().toISOString() })
            .eq("id", member.id)
            .eq("status", "requested");
        if (error) throw error;

        notify(
            member.user_id,
            action === "accept" ? "You're in the ride!" : "Ride request declined",
            action === "accept"
                ? `Your seat in ${routeText(ride)} on ${whenText(ride.depart_from)} is confirmed.`
                : `The host couldn't take you on ${routeText(ride)} on ${whenText(ride.depart_from)}.`,
            ride.id
        );

        const [shaped] = await shapeRides([ride], req.user.id, { detail: true });
        return res.status(200).json({ success: true, ride: shaped });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /api/cab-sharing/rides/:id/leave -> withdraw a request or give up a confirmed seat
export const leaveRide = async (req, res) => {
    try {
        const ride = await findRide(req.params.id);
        if (!ride) return fail(res, 404, "Ride not found");
        const { data: member, error: e1 } = await supabase
            .from("cab_sharing_members")
            .select("*")
            .eq("ride_id", ride.id)
            .eq("user_id", req.user.id)
            .in("status", ["requested", "confirmed"])
            .maybeSingle();
        if (e1) throw e1;
        if (!member) return fail(res, 400, "You're not part of this ride");

        const { error } = await supabase.from("cab_sharing_members").update({ status: "left", responded_at: new Date().toISOString() }).eq("id", member.id);
        if (error) throw error;

        if (member.status === "confirmed" && ride.status === "active") {
            const me = (await loadPeople([req.user.id])).get(req.user.id);
            notify(ride.host_id, "A rider left your ride", `${me?.name || "A rider"} left ${routeText(ride)} on ${whenText(ride.depart_from)}. A seat is open again.`, ride.id);
        }

        const [shaped] = await shapeRides([ride], req.user.id, { detail: true });
        return res.status(200).json({ success: true, message: member.status === "confirmed" ? "You left the ride" : "Request withdrawn", ride: shaped });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /api/cab-sharing/rides/:id/cancel (host only)
export const cancelRide = async (req, res) => {
    try {
        const ride = await findRide(req.params.id);
        if (!ride) return fail(res, 404, "Ride not found");
        if (ride.host_id !== req.user.id) return fail(res, 403, "Only the host can cancel this ride");
        if (ride.status === "cancelled") return fail(res, 400, "Already cancelled");

        const { error } = await supabase.from("cab_sharing_rides").update({ status: "cancelled" }).eq("id", ride.id);
        if (error) throw error;

        const members = (await loadMembers([ride.id])).filter((m) => ["requested", "confirmed"].includes(m.status));
        sendPushToUsers(members.map((m) => ({
            userId: m.user_id,
            type: "rides",
            title: "Ride cancelled",
            body: `The host cancelled ${routeText(ride)} on ${whenText(ride.depart_from)}.`,
            data: { screen: "RideDetail", rideId: ride.id }
        }))).catch((err) => console.error("Failed to send ride push", err));

        const [shaped] = await shapeRides([{ ...ride, status: "cancelled" }], req.user.id, { detail: true });
        return res.status(200).json({ success: true, message: "Ride cancelled", ride: shaped });
    } catch (err) {
        return serverError(res, err);
    }
};
