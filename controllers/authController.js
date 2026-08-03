import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";
import nodemailer from "nodemailer";

// 1. UPDATE PASSWORD
export const updateInitialPassword = async (req, res) => {
    if (!req.body) {
        return res.status(400).json({
            success: false,
            message: "Request body is missing. Ensure you are sending application/json content type and body."
        });
    }
    const { email_id, newPassword } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const { error } = await supabase
            .from("User_Details")
            .update({
                password: hashedPassword,
                is_Valid: true
            })
            .eq("email_id", email_id);

        if (error) throw error;

        res.json({
            success: true,
            message: "Password updated! You can now login."
        });

    } catch (err) {
        console.error(err);
        res.status(400).json({
            success: false,
            message: "Failed to update password"
        });
    }
};


// 2. LOGIN
export const loginUser = async (req, res) => {
    if (!req.body) {
        return res.status(400).json({
            success: false,
            message: "Request body is missing. Ensure you are sending application/json content type and body."
        });
    }
    const { email_id, password } = req.body;

    try {
        // Step 1: Get user from User_Details table
        const { data: user, error } = await supabase
            .from("User_Details")
            .select("*")
            .eq("email_id", email_id)
            .single();

        if (error || !user) {
            return res.status(401).json({
                success: false,
                message: "User not found"
            });
        }

        // Step 2: Check if user has activated account
        if (!user.is_Valid && (user["User Type"] === "Student" || user["User Type"] === "Faculty")) {
            return res.status(403).json({
                success: false,
                needsUpdate: true,
                message: "Update your random password first"
            });
        }

        // Step 3: Check password
        let isMatch = false;
        try {
            isMatch = await bcrypt.compare(password, user.password);
        } catch (err) {
            isMatch = false;
        }

        // Fallback to plain text check
        if (!isMatch) {
            isMatch = (password === user.password);
        }

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid credentials"
            });
        }

        // Step 4: Create JWT payload
        let payload;

        if (user["User Type"] === "Student") {
            // Fetch student details using User_code = user.id
            const { data: studentDetails, error: studentError } = await supabase
                .from("Student_Details")
                .select("*")
                .eq("User_code", user.id)
                .single();

            if (studentError || !studentDetails) {
                return res.status(404).json({
                    success: false,
                    message: "Student details not found"
                });
            }

            payload = {
                user_type: user["User Type"],
                rollnumber: studentDetails["Roll Number"],
                hostel: studentDetails["Hostel_Details"],
                e_mail:user["email_id"],
                id: user.id
            };

        } else {
            payload = {
                user_type: user["User Type"],
                id: user.id,
                e_mail:user["email_id"]
            };
        }

        // Step 5: Generate JWT token with 1 hour expiry
        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        // Step 6: Send response to frontend
        res.json({
            success: true,
            message: "Login successful",
            token,
            userType: user["User Type"]
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

// 3. CHECK ACCOUNT STATUS (does this email already have a PIN set up?)
export const checkAccountStatus = async (req, res) => {
    const { email_id: rawEmail } = req.body || {};
    if (!rawEmail) {
        return res.status(400).json({
            success: false,
            message: "email_id is required"
        });
    }
    const email_id = rawEmail.trim().toLowerCase();

    try {
        const { data: user } = await supabase
            .from("User_Details")
            .select("is_Valid")
            .eq("email_id", email_id)
            .maybeSingle();

        res.json({
            success: true,
            hasPin: !!(user && user.is_Valid)
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

// 4. SEND AUTH VERIFICATION CODE
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
        // Generate a 4-digit code
        const code = String(Math.floor(1000 + Math.random() * 9000));
        console.log(`\n========================================`);
        console.log(`Verification Code for ${email_id}: ${code}`);
        console.log(`========================================\n`);

        // Save code to Redis with 5 minutes expiry
        await redis.set(`auth_otp:${email_id}`, code, { ex: 300 });

        // Send Email
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || "smtp.gmail.com",
            port: Number(process.env.SMTP_PORT) || 587,
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS ? process.env.SMTP_PASS.replace(/\s+/g, "") : "",
            },
        });

        // Fire-and-forget: don't make the client wait on the SMTP round trip
        // (which can hang for minutes if SMTP creds are slow/misconfigured).
        // The code is already saved to Redis and logged above, so verification
        // isn't blocked on the email actually arriving.
        transporter.sendMail({
            from: `"Helios Auth" <${process.env.SMTP_USER || "no-reply@helios.iitbbs.ac.in"}>`,
            to: email_id,
            subject: "Verify Your Email - Helios IIT BBS",
            text: `Your email verification code is: ${code}. This code is valid for 5 minutes.`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                    <h2 style="color: #4F46E5;">Verify Your Email</h2>
                    <p>Use the following 4-digit code to verify your university email and secure your account:</p>
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
            message: "Server Error",
            error: err.message
        });
    }
};

// 5. VERIFY AUTH CODE
export const verifyAuthCode = async (req, res) => {
    const { email_id: rawEmail, code } = req.body;
    if (!rawEmail || !code) {
        return res.status(400).json({
            success: false,
            message: "email_id and code are required"
        });
    }
    const email_id = rawEmail.trim().toLowerCase();
    const cleanCode = code.trim();

    try {
        // Master bypass for testing
        if (cleanCode !== '1234') {
            const savedCode = await redis.get(`auth_otp:${email_id}`);
            if (!savedCode) {
                return res.status(400).json({
                    success: false,
                    message: "Verification code has expired. Please request a new one."
                });
            }
            if (String(savedCode).trim() !== cleanCode) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid verification code. Please check and try again."
                });
            }
        }

        // Delete from Redis on success
        await redis.del(`auth_otp:${email_id}`);

        // Check if user already exists
        const { data: user } = await supabase
            .from("User_Details")
            .select("id")
            .eq("email_id", email_id)
            .maybeSingle();

        res.json({
            success: true,
            message: "Email verified successfully",
            isNewUser: !user
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
};

// 6. REGISTER OR UPDATE USER PIN
export const registerOrUpdateUserPin = async (req, res) => {
    const { email_id: rawEmail, pin } = req.body;
    if (!rawEmail || !pin) {
        return res.status(400).json({
            success: false,
            message: "email_id and pin are required"
        });
    }
    const email_id = rawEmail.trim().toLowerCase();

    try {
        const hashedPassword = await bcrypt.hash(pin, 10);

        // Check if user exists
        const { data: user } = await supabase
            .from("User_Details")
            .select("*")
            .eq("email_id", email_id)
            .maybeSingle();

        if (user) {
            // User exists, update password (PIN)
            const { error: updateError } = await supabase
                .from("User_Details")
                .update({
                    password: hashedPassword,
                    is_Valid: true
                })
                .eq("email_id", email_id);

            if (updateError) throw updateError;
        } else {
            // User does not exist, provision new user and student details!
            const emailPrefix = email_id.split("@")[0];
            const name = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
            const rollNo = emailPrefix.toUpperCase();

            // Insert into User_Details
            const { data: newUser, error: createError } = await supabase
                .from("User_Details")
                .insert([
                    {
                        "User Name": name,
                        email_id: email_id,
                        password: hashedPassword,
                        is_Valid: true,
                        "User Type": "Student",
                        phone_number: "9876543210",
                        is_emergency_number: false
                    }
                ])
                .select()
                .single();

            if (createError) throw createError;

            // Insert into Student_Details
            const { error: studentError } = await supabase
                .from("Student_Details")
                .insert([
                    {
                        "Roll Number": rollNo,
                        Hostel_Details: "Mahanadi",
                        "Room No": "A-101",
                        "Faculty Adviser": "Dr. Ravi Kumar",
                        User_code: newUser.id
                    }
                ]);

            if (studentError) throw studentError;
        }

        // Login the user now to return a valid JWT token
        const { data: loggedInUser } = await supabase
            .from("User_Details")
            .select("*")
            .eq("email_id", email_id)
            .single();

        const { data: studentDetails } = await supabase
            .from("Student_Details")
            .select("*")
            .eq("User_code", loggedInUser.id)
            .maybeSingle();

        const payload = {
            id: loggedInUser.id,
            user_type: loggedInUser["User Type"],
            rollnumber: studentDetails ? studentDetails["Roll Number"] : "EXTERNAL",
            hostel: studentDetails ? studentDetails["Hostel_Details"] : "EXTERNAL",
            e_mail: loggedInUser.email_id
        };

        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: "3650d" } // long lived token for app
        );

        res.json({
            success: true,
            message: "PIN set up successfully",
            token,
            userType: loggedInUser["User Type"]
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
};