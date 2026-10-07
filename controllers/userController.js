import bcrypt from "bcryptjs";
import supabase from "../config/Supabase.js";

export const getMyProfile = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("User_Details")
      .select(`"User Name", email_id, phone_number, "User Type", photoUrl, blood_group`)
      .eq("id", req.user.id)
      .maybeSingle();

    if (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Error fetching profile"
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: req.user.id,
        name: data["User Name"],
        email: data.email_id,
        phoneNumber: data.phone_number,
        userType: data["User Type"],
        photoUrl: data.photoUrl,
        bloodGroup: data.blood_group,
        rollnumber: req.user.rollnumber || null,
        hostel: req.user.hostel || null
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server Error"
    });
  }
};

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

    // Step 2: Identity comes from the authenticated user's token
    // In the login payload, email is stored as e_mail
    const emailId = req.user.e_mail;

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
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Error updating phone number"});
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
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server Error"});
  }
};

export const updateBloodGroup = async (req, res) => {
  try {
    const { blood_group } = req.body;

    if (!blood_group || !/^(A|B|AB|O)[+-]$/.test(String(blood_group).trim().toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: "blood_group must be one of A+, A-, B+, B-, AB+, AB-, O+, O-"
      });
    }

    // Identity comes from the authenticated user's token, same as updatePhoneNumber
    const emailId = req.user.e_mail;

    if (!emailId) {
      return res.status(400).json({
        success: false,
        message: "Email not found in token"
      });
    }

    const { data, error } = await supabase
      .from("User_Details")
      .update({
        blood_group: blood_group
      })
      .eq("email_id", emailId)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Error updating blood group"});
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "User not found with this email"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Blood group updated successfully",
      data
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server Error"});
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
      console.error(uploadError);
      return res.status(500).json({
        success: false,
        message: "Error uploading photo to Supabase Storage"});
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
      console.error(updateError);
      return res.status(500).json({
        success: false,
        message: "Photo uploaded, but failed to update User_Details"});
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
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server Error"});
  }
};

export const changePin = async (req, res) => {
  try {
    const { current_pin, new_pin } = req.body;

    if (!current_pin || !new_pin) {
      return res.status(400).json({
        success: false,
        message: "current_pin and new_pin are required"
      });
    }

    if (!/^\d{6}$/.test(new_pin)) {
      return res.status(400).json({
        success: false,
        message: "New PIN must be a 6-digit number"
      });
    }

    const { data: user, error: fetchError } = await supabase
      .from("User_Details")
      .select("id, password")
      .eq("id", req.user.id)
      .maybeSingle();

    if (fetchError) {
      console.error(fetchError);
      return res.status(500).json({
        success: false,
        message: "Error verifying current PIN"});
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const isMatch = await bcrypt.compare(current_pin, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current PIN is incorrect"
      });
    }

    const hashedPin = await bcrypt.hash(new_pin, 10);

    const { error: updateError } = await supabase
      .from("User_Details")
      .update({ password: hashedPin })
      .eq("id", req.user.id);

    if (updateError) {
      console.error(updateError);
      return res.status(500).json({
        success: false,
        message: "Error updating PIN"});
    }

    return res.status(200).json({
      success: true,
      message: "PIN changed successfully"
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server Error"});
  }
};

// "User Type" enum values managed from the admin dashboard's personnel page
const ADMIN_ROLES = ["Super Admin", "Admin", "Transport Admin", "Time Table Admin", "ORACLE Admin", "Security Guard"];
// Roles that sign in on the mobile app's 6-digit PIN keypad
const PIN_ONLY_ROLES = ["Admin", "ORACLE Admin"];
const ADMIN_COLUMNS = `id, "User Name", email_id, "User Type", is_Valid, phone_number, created_at`;

const formatAdmin = (row) => ({
  id: row.id,
  name: row["User Name"],
  email: row.email_id,
  role: row["User Type"],
  is_valid: row.is_Valid,
  phone_number: row.phone_number,
  created_at: row.created_at
});

// Returns an error message, or null if the password suits the role
const validateAdminPassword = (password, role) => {
  if (PIN_ONLY_ROLES.includes(role)) {
    return /^\d{6}$/.test(password) ? null : `${role} accounts sign in on the app keypad, so the password must be a 6-digit PIN.`;
  }
  return password.length >= 6 ? null : "Password must be at least 6 characters.";
};

export const getAdmins = async (req, res) => {
  try {
    // Explicit columns: never send password hashes to the client
    const { data, error } = await supabase
      .from("User_Details")
      .select(ADMIN_COLUMNS)
      .in("User Type", ADMIN_ROLES)
      .order("id", { ascending: true });

    if (error) throw error;

    return res.status(200).json({ success: true, admins: data.map(formatAdmin) });
  } catch (err) {
    console.error("GET ADMINS ERROR:", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};
// =====================================
// CREATE ADMIN ACCOUNT (SUPER ADMIN)
// POST /api/users/admins  { name, email, role, password }
// =====================================
export const createAdmin = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const role = req.body.role;
    const password = String(req.body.password || "");

    if (!name || !email || !role || !password) {
      return res.status(400).json({ success: false, message: "Name, email, role and password are required." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address." });
    }
    if (!ADMIN_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: `Role must be one of: ${ADMIN_ROLES.join(", ")}` });
    }

    const passwordError = validateAdminPassword(password, role);
    if (passwordError) return res.status(400).json({ success: false, message: passwordError });

    const { data: existing, error: existingError } = await supabase
      .from("User_Details")
      .select(`id, "User Type"`)
      .ilike("email_id", email)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `${email} already has an account (${existing["User Type"]}).`
      });
    }

    const { data, error } = await supabase
      .from("User_Details")
      .insert([{
        "User Name": name,
        email_id: email,
        "User Type": role,
        password: await bcrypt.hash(password, 10),
        is_Valid: true,
        is_emergency_number: false
      }])
      .select(ADMIN_COLUMNS)
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, message: "Administrator registered", admin: formatAdmin(data) });
  } catch (err) {
    console.error("CREATE ADMIN ERROR:", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// =====================================
// UPDATE ADMIN ACCOUNT (SUPER ADMIN)
// PATCH /api/users/admins/:id  { name?, role?, password?, is_valid? }
// is_valid: false revokes access (the account is kept, and can be restored).
// =====================================
export const updateAdmin = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, role, password, is_valid } = req.body;

    const { data: target, error: targetError } = await supabase
      .from("User_Details")
      .select(ADMIN_COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (targetError) throw targetError;
    if (!target || !ADMIN_ROLES.includes(target["User Type"])) {
      return res.status(404).json({ success: false, message: "Administrator not found." });
    }

    const isSelf = id === req.user.id;
    if (isSelf && is_valid === false) {
      return res.status(400).json({ success: false, message: "You can't revoke your own access." });
    }
    if (isSelf && role !== undefined && role !== target["User Type"]) {
      return res.status(400).json({ success: false, message: "You can't change your own role." });
    }

    const updateData = {};

    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ success: false, message: "Name cannot be empty." });
      updateData["User Name"] = String(name).trim();
    }
    if (role !== undefined) {
      if (!ADMIN_ROLES.includes(role)) {
        return res.status(400).json({ success: false, message: `Role must be one of: ${ADMIN_ROLES.join(", ")}` });
      }
      updateData["User Type"] = role;
    }
    if (password) {
      const passwordError = validateAdminPassword(String(password), role || target["User Type"]);
      if (passwordError) return res.status(400).json({ success: false, message: passwordError });
      updateData.password = await bcrypt.hash(String(password), 10);
    }
    if (is_valid !== undefined) updateData.is_Valid = Boolean(is_valid);

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, message: "No fields provided for update" });
    }

    const { data, error } = await supabase
      .from("User_Details")
      .update(updateData)
      .eq("id", id)
      .select(ADMIN_COLUMNS)
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, message: "Administrator updated", admin: formatAdmin(data) });
  } catch (err) {
    console.error("UPDATE ADMIN ERROR:", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};
