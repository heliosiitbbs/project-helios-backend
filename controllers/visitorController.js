import supabase from "../config/Supabase.js";

const VISIT_TYPES = [
  "Event",
  "Internship",
  "Academic / Department Visit",
  "Official / Business Visit",
  "Other",
];

const REQUIRED_TEXT_FIELDS = [
  ["visitor_name", "Visitor full name", 120],
  ["host_name", "Campus contact / person being visited", 200],
  ["purpose", "Purpose", 2000],
  ["destination", "Campus destination", 200],
];

const isValidDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

function validateVisit(body = {}) {
  const visit = {
    visitor_name: String(body.visitor_name || "").trim(),
    visitor_phone: String(body.visitor_phone || "").trim(),
    visitor_email: String(body.visitor_email || "").trim().toLowerCase(),
    blood_group: String(body.blood_group || "").trim().toUpperCase() || null,
    visit_type: String(body.visit_type || "").trim(),
    host_name: String(body.host_name || "").trim(),
    host_contact: String(body.host_contact || "").trim() || null,
    purpose: String(body.purpose || "").trim(),
    destination: String(body.destination || "").trim(),
    visit_date: String(body.visit_date || "").trim(),
    expiry_date: String(body.expiry_date || "").trim(),
    group_name: String(body.group_name || "").trim() || null,
  };
  const errors = {};

  for (const [field, label, maxLength] of REQUIRED_TEXT_FIELDS) {
    if (!visit[field]) errors[field] = `${label} is required.`;
    else if (visit[field].length > maxLength) errors[field] = `${label} must be ${maxLength} characters or fewer.`;
  }

  if (!visit.visitor_phone) errors.visitor_phone = "Visitor phone number is required.";
  else if (!/^\d{10}$/.test(visit.visitor_phone)) errors.visitor_phone = "Visitor phone number must contain exactly 10 digits.";

  if (!visit.visitor_email) errors.visitor_email = "Visitor email is required.";
  else if (visit.visitor_email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(visit.visitor_email)) {
    errors.visitor_email = "Enter a valid visitor email address.";
  }
  if (visit.blood_group && !["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].includes(visit.blood_group)) {
    errors.blood_group = "Choose a valid blood group or leave this field blank.";
  }

  if (!VISIT_TYPES.includes(visit.visit_type)) {
    errors.visit_type = `Visit type must be one of: ${VISIT_TYPES.join(", ")}.`;
  }
  if (!visit.visit_date || !isValidDate(visit.visit_date)) {
    errors.visit_date = "Expected visit date must be a valid date in YYYY-MM-DD format.";
  }
  if (!visit.expiry_date || !isValidDate(visit.expiry_date)) {
    errors.expiry_date = "Pass expiry date must be a valid date in YYYY-MM-DD format.";
  } else if (isValidDate(visit.visit_date) && visit.expiry_date < visit.visit_date) {
    errors.expiry_date = "Pass expiry date cannot be before the expected visit date.";
  }
  if (visit.host_contact && visit.host_contact.length > 254) {
    errors.host_contact = "Campus contact details must be 254 characters or fewer.";
  }
  if (visit.group_name && visit.group_name.length > 200) {
    errors.group_name = "Event, program, or department must be 200 characters or fewer.";
  }

  return { visit, errors };
}

export const registerVisitor = async (req, res) => {
  const { visit, errors } = validateVisit(req.body);
  if (Object.keys(errors).length) {
    return res.status(400).json({
      success: false,
      message: "Please correct the visitor registration details.",
      errors,
    });
  }

  let newVisitorUserId = null;

  try {
    // Link this visit to the account with the submitted email. New visitor
    // accounts are enabled immediately and set their own PIN at first sign-in.
    let { data: visitorUser, error: userLookupError } = await supabase
      .from("User_Details")
      .select('id, email_id, "User Type"')
      .eq("email_id", visit.visitor_email)
      .maybeSingle();

    if (userLookupError) throw userLookupError;

    if (!visitorUser) {
      const { data: createdUser, error: createUserError } = await supabase
        .from("User_Details")
        .insert({
          "User Name": visit.visitor_name,
          email_id: visit.visitor_email,
          password: null,
          "photoUrl": null,
          is_Valid: true,
          "User Type": "Visitor",
          phone_number: visit.visitor_phone,
          is_emergency_number: false,
          blood_group: visit.blood_group,
          "Hostel": null,
          display_name: visit.visitor_name,
        })
        .select('id, email_id, "User Type"')
        .single();

      if (createUserError) {
        // A concurrent request may have created the account after our lookup.
        if (createUserError.code !== "23505") throw createUserError;

        const { data: concurrentUser, error: concurrentLookupError } = await supabase
          .from("User_Details")
          .select('id, email_id, "User Type"')
          .eq("email_id", visit.visitor_email)
          .maybeSingle();

        if (concurrentLookupError) throw concurrentLookupError;
        if (!concurrentUser) throw createUserError;
        visitorUser = concurrentUser;
      } else {
        visitorUser = createdUser;
        newVisitorUserId = createdUser.id;
      }
    }

    const visitRecord = {
      visitor_user_id: visitorUser.id,
      visit_type: visit.visit_type,
      host_name: visit.host_name,
      host_contact: visit.host_contact,
      purpose: visit.purpose,
      destination: visit.destination,
      visit_date: visit.visit_date,
      expiry_date: visit.expiry_date,
      group_name: visit.group_name,
      registered_by_user_id: req.user.id,
    };

    const { data: savedVisit, error: visitInsertError } = await supabase
      .from("visitors_details")
      .insert(visitRecord)
      .select("*")
      .single();

    if (visitInsertError) throw visitInsertError;

    const isVisitorRole = String(visitorUser["User Type"] || "").toLowerCase() === "visitor";

    return res.status(201).json({
      success: true,
      message: "Visitor visit registered successfully.",
      visit: savedVisit,
      visitor: {
        id: visitorUser.id,
        email: visitorUser.email_id,
        role: visitorUser["User Type"],
        accountCreated: newVisitorUserId !== null,
      },
      notice: isVisitorRole
        ? "The visitor account is linked to this visit. The visitor can set up a PIN using this email."
        : `This email already belongs to a ${visitorUser["User Type"]} account; its role and profile were left unchanged.`,
    });
  } catch (error) {
    // Supabase's REST client does not provide a transaction across these two
    // inserts. Remove a just-created, still-unclaimed account if the visit row
    // could not be written, so a failed registration does not leave an orphan.
    if (newVisitorUserId !== null) {
      const { error: rollbackError } = await supabase
        .from("User_Details")
        .delete()
        .eq("id", newVisitorUserId);
      if (rollbackError) {
        console.error("Visitor account rollback failed:", rollbackError.message);
      }
    }

    console.error("Visitor registration failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Visitor registration could not be saved. Check that the visitors_details table has the expected columns, including expiry_date, then try again.",
    });
  }
};


