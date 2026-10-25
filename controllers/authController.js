import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";
import nodemailer from "nodemailer";
import firebaseAuth from "../config/Firebase.js";

// ---------- shared helpers ----------

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const PHONE_REGEX = /^[6-9]\d{9}$/;
// Placeholder some old auto-created accounts were given
const PLACEHOLDER_PHONE = "9876543210";
// Students sign in on the app's 6-digit PIN keypad; staff accounts use passwords
const PIN_ROLES = ["Student", "Visitor"];

// Profile fields a user must fill before using the app. The profile photo is
// optional: it can be added on the first-time form or later in Edit Profile.
// The app signs everyone in with Google, so no PIN is needed.
const missingProfileFields = (user) => {
    // Visitors and the ORACLE team aren't asked for a blood group
    const skipsBloodGroup = ["Visitor", "ORACLE Admin"].includes(user["User Type"]);
    return [
        !String(user.display_name || "").trim() && "display_name",
        (!PHONE_REGEX.test(user.phone_number || "") || user.phone_number === PLACEHOLDER_PHONE) && "phone_number",
        !skipsBloodGroup && !String(user.blood_group || "").trim() && "blood_group"
    ].filter(Boolean);
};

const profileSnapshot = (user) => ({
    name: user["User Name"] || "",
    displayName: user.display_name || "",
    phoneNumber: user.phone_number === PLACEHOLDER_PHONE ? "" : user.phone_number || "",
    bloodGroup: user.blood_group || "",
    photoUrl: user.photoUrl || null
});

// Short-lived token that proves the email (Google or email code) but is NOT a
// session: it only unlocks setting a PIN / completing the profile.
// The protect middleware rejects any token carrying `purpose`.
const issueSetupToken = (user) =>
    jwt.sign({ purpose: "setup", id: user.id, e_mail: user.email_id }, process.env.JWT_SECRET, { expiresIn: "20m" });

const readSetupToken = (req) => {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return null;
    try {
        const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET);
        return decoded.purpose === "setup" ? decoded : null;
    } catch {
        return null;
    }
};

// Accepts either a setup token or a normal session token (a user who signed in
// with their PIN but still has profile details missing)
const readAnyToken = (req) => {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return null;
    try {
        return jwt.verify(header.slice(7), process.env.JWT_SECRET);
    } catch {
        return null;
    }
};

// App sessions (Google sign-in) last 30 days and are renewed each time the app
// opens (/refresh), so people stay signed in until they log out. Password
// logins (admin dashboard) keep short 1-hour sessions that can't be renewed.
const APP_SESSION_TTL = "30d";

// Session JWT + the response fields the frontends expect after a login
const issueSession = async (user, { app = false } = {}) => {
    let payload;
    if (user["User Type"] === "Student") {
        const { data: studentDetails } = await supabase
            .from("Student_Details")
            .select("*")
            .eq("User_code", user.id)
            .maybeSingle();
        if (!studentDetails) return { error: "Student details not found" };
        payload = {
            user_type: user["User Type"],
            rollnumber: studentDetails["Roll Number"],
            hostel: studentDetails["Hostel_Details"],
            e_mail: user["email_id"],
            id: user.id
        };
    } else {
        payload = {
            user_type: user["User Type"],
            id: user.id,
            e_mail: user["email_id"]
        };
    }
    if (app) payload.app = true;
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: app ? APP_SESSION_TTL : "1h" });
    return { token, userType: user["User Type"] };
};

const findUserById = async (id) => {
    const { data, error } = await supabase.from("User_Details").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
};

// ---------- 1. LOGIN (email + PIN / password) ----------
export const loginUser = async (req, res) => {
    if (!req.body) {
        return res.status(400).json({
            success: false,
            message: "Request body is missing. Ensure you are sending application/json content type and body."
        });
    }
    const { email_id: rawEmail, password } = req.body;
    const email_id = String(rawEmail || "").trim().toLowerCase();

    try {
        const { data: user, error } = await supabase
            .from("User_Details")
            .select("*")
            .eq("email_id", email_id)
            .maybeSingle();

        if (error || !user) {
            return res.status(401).json({
                success: false,
                message: "User not found"
            });
        }

        if (user.is_Valid !== true) {
            return res.status(403).json({
                success: false,
                message: "This account is not active. Contact your administrator."
            });
        }

        if (!user.password) {
            return res.status(403).json({
                success: false,
                needsSetup: true,
                message: "No PIN set yet. Sign in with Google to set one up."
            });
        }

        let isMatch = false;
        const isHashed = String(user.password).startsWith("$2");
        if (isHashed) {
            try {
                isMatch = await bcrypt.compare(String(password || ""), user.password);
            } catch {
                isMatch = false;
            }
        } else if (password && password === user.password) {
            // Legacy plaintext row: accept once and store it hashed from now on.
            // Never compared in plaintext against a hash, so a leaked hash can't be used as a password.
            isMatch = true;
            const { error: rehashError } = await supabase
                .from("User_Details")
                .update({ password: await bcrypt.hash(String(password), 10) })
                .eq("id", user.id);
            if (rehashError) console.error("Failed to rehash legacy password:", rehashError.message);
        }

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid credentials"
            });
        }

        const session = await issueSession(user);
        if (session.error) {
            return res.status(404).json({ success: false, message: session.error });
        }

        // Record this login; the previous timestamp is returned so the admin
        // dashboard can show what's new since the user last signed in.
        // A failure here must never block the login itself.
        const previousLoginAt = user.last_login_at ?? null;
        const { error: lastLoginError } = await supabase
            .from("User_Details")
            .update({ last_login_at: new Date().toISOString() })
            .eq("id", user.id);
        if (lastLoginError) console.error("Failed to record last login:", lastLoginError.message);

        const missing = missingProfileFields(user);
        res.json({
            success: true,
            message: "Login successful",
            token: session.token,
            userType: session.userType,
            previousLoginAt,
            // The app sends people with missing details to the profile form first
            profileComplete: missing.length === 0,
            missing,
            profile: profileSnapshot(user)
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

// ---------- 2. VERIFY GOOGLE SIGN-IN ----------
// Google vouches for the email. Only accounts already in User_Details with
// is_Valid = true may continue. A complete profile gets a 30-day app session
// right away; otherwise a setup token for the first-time profile form.
export const verifyGoogleSignIn = async (req, res) => {
    const { id_token: idToken } = req.body || {};
    if (!idToken) {
        return res.status(400).json({
            success: false,
            message: "id_token is required"
        });
    }

    if (!firebaseAuth) {
        console.error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured");
        return res.status(500).json({
            success: false,
            message: "Google sign-in is not configured on the server"
        });
    }

    let decoded;
    try {
        decoded = await firebaseAuth.verifyIdToken(idToken);
    } catch (err) {
        console.error("Google token verification failed:", err.message);
        return res.status(401).json({
            success: false,
            message: "Could not verify Google sign-in"
        });
    }

    try {
        if (!decoded || !decoded.email || !decoded.email_verified) {
            return res.status(401).json({
                success: false,
                message: "Could not verify a confirmed email from this Google account"
            });
        }

        const email_id = decoded.email.trim().toLowerCase();
        const { data: user, error } = await supabase
            .from("User_Details")
            .select("*")
            .eq("email_id", email_id)
            .maybeSingle();

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Error checking account eligibility"
            });
        }

        if (!user || user.is_Valid !== true) {
            return res.status(403).json({
                success: false,
                message: `${email_id} isn't registered for Helios. Contact your department administrator.`
            });
        }

        const missing = missingProfileFields(user);

        // Profile already complete: sign straight in, no further step
        let session = null;
        if (missing.length === 0) {
            session = await issueSession(user, { app: true });
            if (session.error) {
                return res.status(404).json({ success: false, message: session.error });
            }
            await supabase.from("User_Details").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);
        }

        return res.json({
            success: true,
            email_id,
            userType: user["User Type"],
            token: session?.token || null,
            profileComplete: missing.length === 0,
            missing,
            profile: {
                ...profileSnapshot(user),
                // First sign-in: offer the Google profile picture and first name as starting points
                googlePhotoUrl: decoded.picture || null,
                googleName: decoded.name || ""
            },
            setupToken: issueSetupToken(user)
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

// ---------- 3. SEND EMAIL VERIFICATION CODE (admin "forgot password") ----------
// 6-digit code from a CSPRNG, valid 5 minutes, at most one new code a minute per email,
// and a code is thrown away after OTP_MAX_ATTEMPTS wrong guesses.
const OTP_TTL_SECONDS = 300;
const OTP_RESEND_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;

export const sendAuthVerification = async (req, res) => {
    if (!req.body) {
        return res.status(400).json({
            success: false,
            message: "Request body is missing."
        });
    }
    const { email_id: rawEmail } = req.body;
    if (!rawEmail) {
        return res.status(400).json({
            success: false,
            message: "email_id is required"
        });
    }
    const email_id = rawEmail.trim().toLowerCase();

    try {
        // NX: only one new code per email per minute
        const allowed = await redis.set(`auth_otp_cooldown:${email_id}`, "1", { nx: true, ex: OTP_RESEND_SECONDS });
        if (!allowed) {
            return res.status(429).json({
                success: false,
                message: "A code was sent recently. Please wait a minute before requesting another."
            });
        }

        const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
        await redis.set(`auth_otp:${email_id}`, code, { ex: OTP_TTL_SECONDS });
        await redis.del(`auth_otp_attempts:${email_id}`);

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || "smtp.gmail.com",
            port: Number(process.env.SMTP_PORT) || 587,
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS ? process.env.SMTP_PASS.replace(/\s+/g, "") : "",
            },
            // Some hosts (e.g. Render's standard web services) silently drop
            // outbound SMTP-port traffic instead of refusing it, so without a
            // bound this hangs on nodemailer's ~2 minute default instead of
            // failing fast.
            connectionTimeout: 8000,
            greetingTimeout: 8000,
            socketTimeout: 8000,
        });

        // Fire-and-forget: don't make the client wait on the SMTP round trip.
        transporter.sendMail({
            from: `"Helios Auth" <${process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@helios.iitbbs.ac.in"}>`,
            to: email_id,
            subject: "Verify Your Email - Helios IIT BBS",
            text: `Your email verification code is: ${code}. This code is valid for 5 minutes.`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                    <h2 style="color: #4F46E5;">Verify Your Email</h2>
                    <p>Use the following 6-digit code to verify your university email and secure your account:</p>
                    <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #4F46E5; margin: 20px 0;">${code}</p>
                    <p>This code is valid for 5 minutes. Please do not share this code with anyone.</p>
                </div>
            `
        }).catch(err => {
            console.error("Error sending auth email:", err.message);
        });

        res.json({
            success: true,
            message: "Verification code sent successfully"
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

// ---------- 4. VERIFY EMAIL CODE ----------
// A correct code for an active account returns a setup token for /setup-pin.
export const verifyAuthCode = async (req, res) => {
    const { email_id: rawEmail, code } = req.body || {};
    if (!rawEmail || !code) {
        return res.status(400).json({
            success: false,
            message: "email_id and code are required"
        });
    }
    const email_id = rawEmail.trim().toLowerCase();
    const cleanCode = String(code).trim();

    try {
        const savedCode = await redis.get(`auth_otp:${email_id}`);
        if (!savedCode) {
            return res.status(400).json({
                success: false,
                message: "Verification code has expired. Please request a new one."
            });
        }
        if (String(savedCode).trim() !== cleanCode) {
            const attempts = await redis.incr(`auth_otp_attempts:${email_id}`);
            if (attempts === 1) await redis.expire(`auth_otp_attempts:${email_id}`, OTP_TTL_SECONDS);
            if (attempts >= OTP_MAX_ATTEMPTS) {
                await redis.del(`auth_otp:${email_id}`, `auth_otp_attempts:${email_id}`);
                return res.status(429).json({
                    success: false,
                    message: "Too many wrong attempts. Please request a new code."
                });
            }
            return res.status(400).json({
                success: false,
                message: "Invalid verification code. Please check and try again."
            });
        }

        await redis.del(`auth_otp:${email_id}`, `auth_otp_attempts:${email_id}`);

        const { data: user } = await supabase
            .from("User_Details")
            .select("id, email_id, is_Valid")
            .eq("email_id", email_id)
            .maybeSingle();

        if (!user || user.is_Valid !== true) {
            return res.status(403).json({
                success: false,
                message: "This email isn't registered for Helios. Contact your administrator."
            });
        }

        res.json({
            success: true,
            message: "Email verified successfully",
            setupToken: issueSetupToken(user)
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

// ---------- 5. SET / RESET PIN (requires a setup token) ----------
export const registerOrUpdateUserPin = async (req, res) => {
    const setup = readSetupToken(req);
    if (!setup) {
        return res.status(401).json({
            success: false,
            message: "Verify your email (Google sign-in or email code) before setting a PIN."
        });
    }
    const pin = String((req.body || {}).pin || "");

    try {
        const user = await findUserById(setup.id);
        if (!user || user.is_Valid !== true) {
            return res.status(403).json({ success: false, message: "This account is not active." });
        }

        const isPinRole = PIN_ROLES.includes(user["User Type"]);
        if (isPinRole ? !/^\d{6}$/.test(pin) : pin.length < 6) {
            return res.status(400).json({
                success: false,
                message: isPinRole ? "The PIN must be exactly 6 digits." : "The password must be at least 6 characters."
            });
        }

        const { error } = await supabase
            .from("User_Details")
            .update({ password: await bcrypt.hash(pin, 10) })
            .eq("id", user.id);
        if (error) throw error;

        const session = await issueSession(user);
        if (session.error) {
            return res.status(404).json({ success: false, message: session.error });
        }

        const missing = missingProfileFields({ ...user, password: "set" });
        res.json({
            success: true,
            message: "PIN set up successfully",
            token: session.token,
            userType: session.userType,
            profileComplete: missing.length === 0,
            missing
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

// ---------- 6. COMPLETE PROFILE (multipart: display_name, phone_number, blood_group, photo?) ----------
// Called with a setup token (first sign-in through Google) or a session token
// (signed in but details are still missing). Every missing field is required;
// fields that are already filled may be left out. Returns a 30-day app session.
export const completeProfile = async (req, res) => {
    const decoded = readAnyToken(req);
    if (!decoded) {
        return res.status(401).json({ success: false, message: "Sign in again to continue." });
    }

    try {
        const user = await findUserById(decoded.id);
        if (!user || user.is_Valid !== true) {
            return res.status(403).json({ success: false, message: "This account is not active." });
        }

        const body = req.body || {};
        const update = {};
        const fail = (message) => res.status(400).json({ success: false, message });

        const displayName = String(body.display_name ?? "").trim();
        if (displayName) {
            if (displayName.length < 2 || displayName.length > 40) return fail("Your name should be 2–40 characters.");
            update.display_name = displayName;
        }

        const phone = String(body.phone_number ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
        if (phone) {
            if (!PHONE_REGEX.test(phone) || phone === PLACEHOLDER_PHONE) return fail("Enter a valid 10-digit mobile number.");
            update.phone_number = phone;
        }

        const blood = String(body.blood_group ?? "").trim().toUpperCase();
        if (blood) {
            if (!BLOOD_GROUPS.includes(blood)) return fail("Choose a valid blood group.");
            update.blood_group = blood;
        }

        if (req.file) {
            const ext = (req.file.originalname.split(".").pop() || "jpg").toLowerCase();
            const filePath = `users/${user.email_id.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}.${ext}`;
            const { data: uploaded, error: uploadError } = await supabase.storage
                .from("Profile_Photos")
                .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
            if (uploadError) {
                console.error(uploadError);
                return res.status(500).json({ success: false, message: "Couldn't upload the photo. Try again." });
            }
            update.photoUrl = supabase.storage.from("Profile_Photos").getPublicUrl(uploaded.path).data.publicUrl;
        }

        // Everything still missing after this request must have been provided
        const stillMissing = missingProfileFields({ ...user, ...update });
        if (stillMissing.length) {
            const labels = { display_name: "your name", phone_number: "a phone number", blood_group: "your blood group" };
            return fail(`Please add ${stillMissing.map((f) => labels[f]).join(", ")}.`);
        }

        if (Object.keys(update).length) {
            const { error } = await supabase.from("User_Details").update(update).eq("id", user.id);
            if (error) throw error;
        }

        const session = await issueSession(user, { app: true });
        if (session.error) {
            return res.status(404).json({ success: false, message: session.error });
        }

        await supabase.from("User_Details").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);

        res.json({
            success: true,
            message: "Profile saved",
            token: session.token,
            userType: session.userType,
            email_id: user.email_id
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

// ---------- 7. RENEW APP SESSION ----------
// The app calls this each time it opens. A still-valid app session (from Google
// sign-in) is swapped for a fresh 30-day one, so people stay signed in until
// they log out. Disabled accounts (is_Valid false) are refused, signing them out.
export const refreshSession = async (req, res) => {
    const decoded = readAnyToken(req);
    if (!decoded || decoded.purpose || !decoded.app) {
        return res.status(401).json({ success: false, message: "Sign in again to continue." });
    }

    try {
        const user = await findUserById(decoded.id);
        if (!user || user.is_Valid !== true) {
            return res.status(401).json({ success: false, message: "This account is not active." });
        }

        const session = await issueSession(user, { app: true });
        if (session.error) {
            return res.status(401).json({ success: false, message: session.error });
        }

        res.json({ success: true, token: session.token, userType: session.userType, email_id: user.email_id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};
