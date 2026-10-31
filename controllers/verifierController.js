import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";
import { checkInPass } from "./eventController.js";

// Event verifiers are door-staff accounts for one event (sql/007_event_verifiers.sql).
// The Super Admin creates them in bulk; each gets a username + random password,
// shown once. They sign in on the app's "Other ways to sign in" screen and can
// only scan passes for their event, from the moment they're created until the
// event ends. Like hostel staff, they have no User_Details account, so they use
// their own token (purpose "verifier") and middleware instead of `protect`.

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_SECONDS = 15 * 60;
const MAX_PER_REQUEST = 50;

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const serverError = (res, err) => {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
};

// No 0/O/1/l/I, so a password read off a screen or a printout can't be mistyped
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const randomPassword = (length = 10) =>
    Array.from(crypto.randomBytes(length), (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join("");

// "Star Night Pravah '26" -> "starnight"
const usernamePrefix = (eventName) =>
    String(eventName || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "event";

// Changes whenever the password does, so a reset signs the old sessions out
const passwordVersion = (hash) => hash.slice(-10);

const hasEnded = (event) => new Date(event.end_time) <= new Date();

const findEvent = async (eventId) => {
    const { data, error } = await supabase
        .from("event_details")
        .select("event_id, event_name, start_time, end_time")
        .eq("event_id", eventId)
        .maybeSingle();
    if (error) throw error;
    return data;
};

const publicEvent = (event) => ({
    event_id: event.event_id,
    event_name: event.event_name,
    start_time: event.start_time,
    end_time: event.end_time
});

// ---------- Verifier sign-in & scanning (app) ----------

// POST /api/verifiers/login { username, password }
export const verifierLogin = async (req, res) => {
    try {
        const username = String(req.body.username || "").trim().toLowerCase();
        const password = String(req.body.password || "");
        if (!username || !password) return fail(res, 400, "Enter your username and password");

        const failKey = `verifier_login_fail:${username}`;
        const failures = Number(await redis.get(failKey)) || 0;
        if (failures >= MAX_FAILED_LOGINS) {
            return fail(res, 429, "Too many wrong attempts. Try again in 15 minutes, or ask the event admin to reset your password.");
        }

        const { data: verifier, error } = await supabase
            .from("event_verifiers")
            .select("*")
            .eq("username", username)
            .maybeSingle();
        if (error) throw error;

        if (!verifier || !(await bcrypt.compare(password, verifier.password_hash))) {
            const count = await redis.incr(failKey);
            if (count === 1) await redis.expire(failKey, LOCKOUT_SECONDS);
            return fail(res, 401, "Wrong username or password");
        }
        await redis.del(failKey);

        const event = await findEvent(verifier.event_id);
        if (!event || hasEnded(event)) {
            return fail(res, 403, "This event has ended, so this verifier account no longer works.");
        }

        // The session can't outlive the event
        const secondsLeft = Math.max(60, Math.floor((new Date(event.end_time) - Date.now()) / 1000));
        const token = jwt.sign(
            { purpose: "verifier", verifier_id: verifier.id, pv: passwordVersion(verifier.password_hash) },
            process.env.JWT_SECRET,
            { expiresIn: secondsLeft }
        );

        return res.status(200).json({
            success: true,
            token,
            userType: "Event Verifier",
            username: verifier.username,
            event: publicEvent(event)
        });
    } catch (err) {
        return serverError(res, err);
    }
};

// Middleware: verifies a verifier session and attaches req.verifier and req.event.
// (The regular `protect` rejects these tokens because of their `purpose`.)
export const protectVerifier = async (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer") ? header.split(" ")[1] : null;
    if (!token) return fail(res, 401, "Not authorized, no token");

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return fail(res, 401, "Your verifier access has ended. Please sign in again.");
    }
    if (decoded.purpose !== "verifier") return fail(res, 401, "Not authorized");

    try {
        const { data: verifier, error } = await supabase
            .from("event_verifiers")
            .select("*")
            .eq("id", decoded.verifier_id)
            .maybeSingle();
        if (error) throw error;

        if (!verifier || passwordVersion(verifier.password_hash) !== decoded.pv) {
            return fail(res, 401, "Your verifier access has ended. Please sign in again.");
        }

        const event = await findEvent(verifier.event_id);
        if (!event || hasEnded(event)) {
            return fail(res, 401, "This event has ended, so your verifier access has ended.");
        }

        req.verifier = verifier;
        req.event = event;
        next();
    } catch (err) {
        return serverError(res, err);
    }
};

// GET /api/verifiers/me
export const getVerifierSession = async (req, res) => {
    return res.status(200).json({
        success: true,
        username: req.verifier.username,
        event: publicEvent(req.event)
    });
};

// POST /api/verifiers/scan { pass_id }
export const verifierScanPass = async (req, res) => {
    const pass_id = String(req.body.pass_id || "").trim();
    if (!pass_id) return fail(res, 400, "pass_id is required.");

    try {
        return await checkInPass(res, req.event, pass_id);
    } catch (err) {
        console.error(err);
        return fail(res, 500, "Server Error scanning pass.");
    }
};

// ---------- Super Admin management (admin dashboard) ----------

// GET /api/verifiers - every verifier account, newest event first
export const listVerifiers = async (req, res) => {
    try {
        const { data: verifiers, error } = await supabase
            .from("event_verifiers")
            .select("id, event_id, username, created_at")
            .order("created_at", { ascending: true });
        if (error) throw error;

        const eventIds = [...new Set(verifiers.map((v) => v.event_id))];
        let eventsById = {};
        if (eventIds.length > 0) {
            const { data: events, error: eventsError } = await supabase
                .from("event_details")
                .select("event_id, event_name, start_time, end_time")
                .in("event_id", eventIds);
            if (eventsError) throw eventsError;
            eventsById = Object.fromEntries(events.map((e) => [e.event_id, e]));
        }

        return res.status(200).json({
            success: true,
            verifiers: verifiers.map((v) => {
                const event = eventsById[v.event_id];
                return {
                    ...v,
                    event_name: event?.event_name || null,
                    end_time: event?.end_time || null,
                    active: !!event && !hasEnded(event)
                };
            })
        });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /api/verifiers { event_id, count } - returns the new usernames and passwords, once
export const createVerifiers = async (req, res) => {
    try {
        const count = Number(req.body.count);
        if (!Number.isInteger(count) || count < 1 || count > MAX_PER_REQUEST) {
            return fail(res, 400, `Number of verifiers must be between 1 and ${MAX_PER_REQUEST}.`);
        }

        const event = await findEvent(req.body.event_id);
        if (!event) return fail(res, 404, "Event not found.");
        if (hasEnded(event)) return fail(res, 400, "This event has already ended.");

        // Usernames like starnight-4k7q; check the candidates aren't taken
        const prefix = usernamePrefix(event.event_name);
        const candidates = new Set();
        while (candidates.size < count * 2) candidates.add(`${prefix}-${randomPassword(4).toLowerCase()}`);

        const { data: taken, error: takenError } = await supabase
            .from("event_verifiers")
            .select("username")
            .in("username", [...candidates]);
        if (takenError) throw takenError;
        const takenSet = new Set(taken.map((t) => t.username));
        const usernames = [...candidates].filter((u) => !takenSet.has(u)).slice(0, count);
        if (usernames.length < count) return fail(res, 409, "Couldn't generate unique usernames. Please try again.");

        const accounts = usernames.map((username) => ({ username, password: randomPassword() }));
        const rows = await Promise.all(
            accounts.map(async ({ username, password }) => ({
                event_id: event.event_id,
                username,
                password_hash: await bcrypt.hash(password, 10)
            }))
        );

        const { data: inserted, error } = await supabase
            .from("event_verifiers")
            .insert(rows)
            .select("id, event_id, username, created_at");
        if (error) throw error;

        const passwordByUsername = Object.fromEntries(accounts.map((a) => [a.username, a.password]));
        return res.status(201).json({
            success: true,
            message: `Created ${inserted.length} verifier${inserted.length === 1 ? "" : "s"} for ${event.event_name}.`,
            verifiers: inserted.map((v) => ({
                ...v,
                password: passwordByUsername[v.username],
                event_name: event.event_name,
                end_time: event.end_time,
                active: true
            }))
        });
    } catch (err) {
        return serverError(res, err);
    }
};

// POST /api/verifiers/:id/reset-password - new password (shown once); signs the old sessions out
export const resetVerifierPassword = async (req, res) => {
    try {
        const password = randomPassword();
        const { data, error } = await supabase
            .from("event_verifiers")
            .update({ password_hash: await bcrypt.hash(password, 10) })
            .eq("id", req.params.id)
            .select("id, username")
            .maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 404, "Verifier not found.");

        await redis.del(`verifier_login_fail:${data.username}`);
        return res.status(200).json({ success: true, username: data.username, password });
    } catch (err) {
        return serverError(res, err);
    }
};

// DELETE /api/verifiers/:id - removes the account; any signed-in session stops working
export const deleteVerifier = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("event_verifiers")
            .delete()
            .eq("id", req.params.id)
            .select("id");
        if (error) throw error;
        if (!data?.length) return fail(res, 404, "Verifier not found.");

        return res.status(200).json({ success: true, message: "Verifier removed." });
    } catch (err) {
        return serverError(res, err);
    }
};
