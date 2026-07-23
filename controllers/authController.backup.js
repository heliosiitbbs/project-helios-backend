// import bcrypt from "bcryptjs";
// import jwt from "jsonwebtoken";
// import  supabase  from "../config/Supabase.js";

// // 1. UPDATE PASSWORD
// export const updateInitialPassword = async (req, res) => {
//     const { email_id, newPassword } = req.body;

//     try {
//         const hashedPassword = await bcrypt.hash(newPassword, 10);

//         const { error } = await supabase
//             .from("User_Details")
//             .update({
//                 password: hashedPassword,
//                 is_Valid: true
//             })
//             .eq("email_id", email_id);

//         if (error) throw error;

//         res.json({
//             success: true,
//             message: "Password updated! You can now login."
//         });

//     } catch (err) {
//         res.status(400).json({
//             success: false,
//             message: err.message
//         });
//     }
// };


// // 2. LOGIN
// export const loginUser = async (req, res) => {
//     const { email_id, password } = req.body;

//     try {
//         // Step 1: Get user from User_Details table
//         const { data: user, error } = await supabase
//             .from("User_Details")
//             .select("*")
//             .eq("email_id", email_id)
//             .single();

//         if (error || !user) {
//             return res.status(401).json({
//                 success: false,
//                 message: "User not found"
//             });
//         }

//         // Step 2: Check if user has activated account
//         if (!user.is_Valid && (user["User Type"] === "Student" || user["User Type"] === "Faculty")) {
//             return res.status(403).json({
//                 success: false,
//                 needsUpdate: true,
//                 message: "Update your random password first"
//             });
//         }

//         // Step 3: Check password
//         const isMatch = await bcrypt.compare(password, user.password);

//         if (!isMatch) {
//             return res.status(401).json({
//                 success: false,
//                 message: "Invalid credentials"
//             });
//         }

//         // Step 4: Create JWT payload
//         let payload;

//         if (user["User Type"] === "Student") {
//             // Fetch student details using User_code = user.id
//             const { data: studentDetails, error: studentError } = await supabase
//                 .from("Student_Details")
//                 .select("*")
//                 .eq("User_code", user.id)
//                 .single();

//             if (studentError || !studentDetails) {
//                 return res.status(404).json({
//                     success: false,
//                     message: "Student details not found"
//                 });
//             }

//             payload = {
//                 id:user.id,
//                 user_type: user["User Type"],
//                 rollnumber: studentDetails["Roll Number"],
//                 hostel: studentDetails["Hostel_Details"]
//             };

//         } else {
//             payload = {
//                 user_type: user["User Type"],
//                 id: user.id
//             };
//         }

//         // Step 5: Generate JWT token with 1 hour expiry
//         const token = jwt.sign(
//             payload,
//             process.env.JWT_SECRET,
//             { expiresIn: "1h" }
//         );

//         // Step 6: Send response to frontend
//         res.json({
//             success: true,
//             message: "Login successful",
//             token,
//             userType: user["User Type"]
//         });

//     } catch (err) {
//         res.status(500).json({
//             success: false,
//             message: "Server Error",
//             error: err.message
//         });
//     }
// };




import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import  supabase  from "../config/Supabase.js";

// 1. UPDATE PASSWORD
export const updateInitialPassword = async (req, res) => {
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
        res.status(400).json({
            success: false,
            message: err.message
        });
    }
};


// 2. LOGIN
export const loginUser = async (req, res) => {
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
        const isMatch = await bcrypt.compare(password, user.password);

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
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: err.message
        });
    }
};
