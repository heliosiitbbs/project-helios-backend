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

    // 3. Check user validity from database
    const { data: userData, error: userError } = await supabase
      .from("User_Details")
      .select("id, email_id, is_Valid")
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

    // 4. Attach user info to request
    req.user = {
      ...decoded,
      dbUser: userData
    };

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