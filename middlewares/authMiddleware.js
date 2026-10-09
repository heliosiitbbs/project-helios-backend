import jwt from 'jsonwebtoken';

import supabase from "../config/Supabase.js";

export const protect = async (req, res, next) => {
  let token;

  // 1. Check if token exists in headers
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Not authorized, no token"
    });
  }

  try {
    // 2. Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Short-lived setup tokens (Google check / email code, before a PIN exists)
    // only unlock the auth endpoints that ask for them - never the rest of the API
    if (decoded.purpose) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, finish signing in first"
      });
    }

    // 3. Check user validity from database
    const { data: userData, error: userError } = await supabase
      .from("User_Details")
      .select(`id, email_id, is_Valid, Hostel, Student_Details ("Roll Number", Hostel_Details)`)
      .eq("id", decoded.id)
      .maybeSingle();

    if (userError) {
      return res.status(500).json({
        success: false,
        message: "Error checking user validity",
        error: userError.message
      });
    }

    if (!userData) {
      return res.status(401).json({
        success: false,
        message: "User not found"
      });
    }

    if (userData.is_Valid !== true) {
      return res.status(403).json({
        success: false,
        message: "User account is invalid or deactivated"
      });
    }

    // 4. Attach user info to request. For students, roll number and hostel
    // come from the database rather than the token, so an admin changing
    // them takes effect without the student having to log in again.
    const { Student_Details: studentRows, ...dbUser } = userData;
    const student = Array.isArray(studentRows) ? studentRows[0] : studentRows;

    req.user = {
      ...decoded,
      dbUser
    };

    if (decoded.user_type === "Student" && student) {
      req.user.rollnumber = student["Roll Number"];
      req.user.hostel = student.Hostel_Details;
    }

    // A Hostel Admin manages the hostel set on their User_Details row
    if (decoded.user_type === "Hostel Admin") {
      req.user.hostel = dbUser.Hostel || null;
    }

    next();

  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Token failed",
      error: error.message
    });
  }
};

// 4. Role Authorization Middleware
export const authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.user_type)) {
            return res.status(403).json({ 
                message: `User role ${req.user.user_type} is not authorized to access this route` 
            });
        }
        next();
    };
};