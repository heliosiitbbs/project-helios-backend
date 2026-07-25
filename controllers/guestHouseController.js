import supabase from "../config/Supabase.js";

// Must match the guest_house_bookings_approval_category_check CHECK constraint exactly
const VALID_APPROVAL_CATEGORIES = [
    "Booking by students for their parents or relatives - Approval from faculty advisor",
    "Booking by Non Teaching Staff for their relatives - Approval from the Section/ Department/ School Head.",
    "Booking by All others such as New Admitted Student/ Scholars, Technicians, Persons appearing for interview etc.- Letter issued by JEE/ IIT Administration",
    "Approval not required"
];

// Must match the guest_house_bookings_service_type_check CHECK constraint exactly
const VALID_SERVICE_TYPES = [
    "Accommodation & Dining Service",
    "Dining Service only",
    "Meeting Room only",
    "Meeting Room & Dining"
];

async function uploadDoc(file, folder, safeId) {
    const fileExtension = file.originalname.split(".").pop();
    const filePath = `${folder}/${safeId}_${Date.now()}.${fileExtension}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
        .from("guest_house_forms")
        .upload(filePath, file.buffer, {
            contentType: file.mimetype
        });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
        .from("guest_house_forms")
        .getPublicUrl(uploadData.path);

    return publicUrlData.publicUrl;
}

// =====================================
// CREATE BOOKING
// =====================================

export const createBooking = async (req, res) => {
    try {
        const {
            service_type,
            purpose_of_booking,
            check_in,
            check_out,
            approval_category
        } = req.body;

        const meals = req.body.meals
            ? [].concat(req.body.meals)
            : [];

        if (
            !service_type ||
            !purpose_of_booking ||
            !check_in ||
            !check_out ||
            !approval_category
        ) {
            return res.status(400).json({
                success: false,
                message: "service_type, purpose_of_booking, check_in, check_out and approval_category are required."
            });
        }

        if (!VALID_SERVICE_TYPES.includes(service_type)) {
            return res.status(400).json({
                success: false,
                message: `service_type must be one of: ${VALID_SERVICE_TYPES.join(", ")}`
            });
        }

        if (!VALID_APPROVAL_CATEGORIES.includes(approval_category)) {
            return res.status(400).json({
                success: false,
                message: `approval_category must be one of: ${VALID_APPROVAL_CATEGORIES.join(", ")}`
            });
        }

        if (meals.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Select at least one meal."
            });
        }

        const visitorIdCardFile = req.files?.visitor_id_card?.[0];
        const approvalProofFile = req.files?.approval_proof?.[0];

        if (!visitorIdCardFile) {
            return res.status(400).json({
                success: false,
                message: "Visitor's I-card is required."
            });
        }

        // Look up the applicant's display name from User_Details - the JWT only carries email
        const { data: userRow, error: userError } = await supabase
            .from("User_Details")
            .select('"User Name"')
            .eq("id", req.user.id)
            .maybeSingle();

        if (userError) throw userError;

        const applicant_name = userRow?.["User Name"] || req.user.e_mail;
        const designation = req.user.user_type === "Student" ? "Student" : req.user.user_type;
        const department_section = req.user.hostel || "N/A";
        const safeId = String(req.user.id).replace(/[^a-zA-Z0-9]/g, "_");

        const visitor_id_card_url = await uploadDoc(visitorIdCardFile, "id_cards", safeId);
        const approval_proof_url = approvalProofFile
            ? await uploadDoc(approvalProofFile, "approval_proofs", safeId)
            : null;

        const { data: booking, error: insertError } = await supabase
            .from("guest_house_bookings")
            .insert([
                {
                    email: req.user.e_mail,
                    applicant_name,
                    designation,
                    department_section,
                    service_type,
                    purpose_of_booking,
                    booking_date: check_in.slice(0, 10),
                    check_in,
                    check_out,
                    approval_category,
                    visitor_id_card_url,
                    approval_proof_url,
                    ID: req.user.rollnumber || null
                }
            ])
            .select()
            .single();

        if (insertError) throw insertError;

        const mealRows = meals.map((meal_type) => ({
            booking_id: booking.booking_id,
            meal_type
        }));

        const { error: mealsError } = await supabase
            .from("booking_meals")
            .insert(mealRows);

        if (mealsError) throw mealsError;

        return res.status(201).json({
            success: true,
            message: "Booking request submitted successfully.",
            booking: { ...booking, meals }
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Error creating guest house booking."
        });
    }
};

// =====================================
// GET MY BOOKINGS
// =====================================

export const getMyBookings = async (req, res) => {
    try {
        const { data: bookings, error } = await supabase
            .from("guest_house_bookings")
            .select("*")
            .eq("email", req.user.e_mail)
            .order("created_at", { ascending: false });

        if (error) throw error;

        const bookingIds = bookings.map((b) => b.booking_id);

        let mealsByBooking = {};
        if (bookingIds.length > 0) {
            const { data: meals, error: mealsError } = await supabase
                .from("booking_meals")
                .select("*")
                .in("booking_id", bookingIds);

            if (mealsError) throw mealsError;

            mealsByBooking = meals.reduce((acc, m) => {
                (acc[m.booking_id] ||= []).push(m.meal_type);
                return acc;
            }, {});
        }

        const enrichedBookings = bookings.map((b) => ({
            ...b,
            meals: mealsByBooking[b.booking_id] || []
        }));

        return res.status(200).json({
            success: true,
            count: enrichedBookings.length,
            bookings: enrichedBookings
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Error fetching your bookings."
        });
    }
};
