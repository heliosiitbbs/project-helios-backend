import supabase from "../config/Supabase.js";
import jwt from "jsonwebtoken";
export const updatePhoneNumber = async (req, res) => {
  try {
    const { phone_number } = req.body;

    // Step 1: Validate phone number input
    if (!phone_number) {
      return res.status(400).json({
        success: false,
        message: "phone_number is required"
      });
    }

    // Optional basic validation for Indian mobile number
    const phoneRegex = /^[6-9]\d{9}$/;

    if (!phoneRegex.test(phone_number)) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number. Enter a valid 10-digit mobile number"
      });
    }

    // Step 2: Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access token missing"
      });
    }

    const token = authHeader.split(" ")[1];

    // Step 3: Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // In your login payload, email is stored as e_mail
    const emailId = decoded.e_mail;

    if (!emailId) {
      return res.status(400).json({
        success: false,
        message: "Email not found in token"
      });
    }

    // Step 4: Update phone number using email_id
    const { data, error } = await supabase
      .from("User_Details")
      .update({
        phone_number: phone_number
      })
      .eq("email_id", emailId)
      .select("*")
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Error updating phone number",
        error: error.message
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "User not found with this email"
      });
    }

    // Step 5: Send response
    return res.status(200).json({
      success: true,
      message: "Phone number updated successfully",
      data
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
};




export const uploadUserPhoto = async (req, res) => {
  try {
    // Step 1: Check if photo exists
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Photo is required"
      });
    }

    // Step 2: Get email/user id from JWT
    const emailId = req.user.e_mail || req.user.email_id || req.user.dbUser?.email_id;
    const userId = req.user.id || req.user.dbUser?.id;

    if (!emailId && !userId) {
      return res.status(400).json({
        success: false,
        message: "User details not found in token"
      });
    }

    // Step 3: Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: "Only JPG, PNG, and WEBP images are allowed"
      });
    }

    // Step 4: Create safe file path
    const fileExtension = req.file.originalname.split(".").pop();

    const safeUserName = emailId
      ? emailId.replace(/[^a-zA-Z0-9]/g, "_")
      : `user_${userId}`;

    const filePath = `users/${safeUserName}_${Date.now()}.${fileExtension}`;

    // Step 5: Upload photo to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("Profile_Photos")
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true
      });

    if (uploadError) {
      return res.status(500).json({
        success: false,
        message: "Error uploading photo to Supabase Storage",
        error: uploadError.message
      });
    }

    // Step 6: Get public URL
    const { data: publicUrlData } = supabase.storage
      .from("Profile_Photos")
      .getPublicUrl(uploadData.path);

    const photoUrl = publicUrlData.publicUrl;

    // Step 7: Update photoUrl in User_Details
    let query = supabase
      .from("User_Details")
      .update({
        photoUrl: photoUrl
      });

    if (userId) {
      query = query.eq("id", userId);
    } else {
      query = query.eq("email_id", emailId);
    }

    const { data: updatedUser, error: updateError } = await query
      .select("*")
      .maybeSingle();

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: "Photo uploaded, but failed to update User_Details",
        error: updateError.message
      });
    }

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Step 8: Send response
    return res.status(200).json({
      success: true,
      message: "Photo uploaded successfully",
      photoUrl,
      filePath: uploadData.path,
      user: updatedUser
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
};