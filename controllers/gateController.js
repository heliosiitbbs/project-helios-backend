import supabase from "../config/Supabase.js";

const STUDENT_STATUS_FILTERS = {
    not_returned: (query) => query.is("in_time", null),
    returned: (query) => query.not("in_time", "is", null)
};

const GUEST_STATUS_FILTERS = {
    still_in: (query) => query.is("out_time", null),
    left: (query) => query.not("out_time", "is", null)
};

async function attachStudentDetails(entries) {
    const rollNumbers = [...new Set(entries.map((e) => e.student_roll_number).filter(Boolean))];
    if (rollNumbers.length === 0) return entries;

    const { data: students, error } = await supabase
        .from("Student_Details")
        .select(`
            "Roll Number",
            Hostel_Details,
            "Room No",
            User_Details ( "User Name" )
        `)
        .in("Roll Number", rollNumbers);

    if (error) throw error;

    const byRollNumber = {};
    for (const s of students || []) {
        byRollNumber[s["Roll Number"]] = s;
    }

    return entries.map((e) => {
        const student = byRollNumber[e.student_roll_number];
        return {
            ...e,
            student_name: student?.User_Details?.["User Name"] || null,
            hostel: student?.Hostel_Details || null,
            room_number: student?.["Room No"] || null
        };
    });
}

// GET /api/gate/students
export const getStudentEntries = async (req, res) => {
    try {
        const { status = "all", from, to, vehicle_number } = req.query;

        let query = supabase
            .from("gate_entries")
            .select("*, gate_sessions(vehicle_number, visiting_location, direction)")
            .eq("person_type", "student")
            .order("out_time", { ascending: false });

        if (STUDENT_STATUS_FILTERS[status]) {
            query = STUDENT_STATUS_FILTERS[status](query);
        }
        if (from) query = query.gte("out_time", from);
        if (to) query = query.lte("out_time", to);

        const { data, error } = await query;
        if (error) throw error;

        let entries = data || [];
        if (vehicle_number) {
            entries = entries.filter((e) => e.gate_sessions?.vehicle_number === vehicle_number);
        }

        entries = await attachStudentDetails(entries);

        return res.status(200).json({ success: true, entries });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to fetch student gate entries",
            error: error.message
        });
    }
};

// GET /api/gate/guests
export const getGuestEntries = async (req, res) => {
    try {
        const { status = "all", from, to, vehicle_number } = req.query;

        let query = supabase
            .from("gate_entries")
            .select("*, gate_sessions(vehicle_number, visiting_location, direction)")
            .eq("person_type", "guest")
            .order("in_time", { ascending: false });

        if (GUEST_STATUS_FILTERS[status]) {
            query = GUEST_STATUS_FILTERS[status](query);
        }
        if (from) query = query.gte("in_time", from);
        if (to) query = query.lte("in_time", to);

        const { data, error } = await query;
        if (error) throw error;

        let entries = data || [];
        if (vehicle_number) {
            entries = entries.filter((e) => e.gate_sessions?.vehicle_number === vehicle_number);
        }

        return res.status(200).json({ success: true, entries });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to fetch guest gate entries",
            error: error.message
        });
    }
};

// GET /api/gate/vehicle-numbers
export const getVehicleNumbers = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("gate_sessions")
            .select("vehicle_number")
            .not("vehicle_number", "is", null);

        if (error) throw error;

        const vehicleNumbers = [...new Set((data || []).map((s) => s.vehicle_number).filter(Boolean))].sort();

        return res.status(200).json({ success: true, vehicleNumbers });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to fetch vehicle numbers",
            error: error.message
        });
    }
};
