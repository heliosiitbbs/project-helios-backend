import supabase from "../config/Supabase.js";

// =====================================
// GET ALL ACTIVE CAB RIDES
// GET /api/cab-sharing/rides?category=airport|station|all
// =====================================
export const getAllRides = async (req, res) => {
  try {
    const { category } = req.query;

    let query = supabase
      .from("cab_sharing_rides")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (category && category !== "all") {
      query = query.eq("category", category);
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.status(200).json({
      success: true,
      count: data ? data.length : 0,
      rides: data || []
    });
  } catch (err) {
    console.error("Error fetching cab rides:", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// =====================================
// CREATE A NEW CAB RIDE
// POST /api/cab-sharing/rides
// =====================================
export const createRide = async (req, res) => {
  try {
    const {
      origin,
      destination,
      pickup_point,
      drop_point,
      category,
      ride_date,
      start_time,
      end_time,
      vehicle_type,
      seats_total,
      price_per_seat,
      comments,
      is_baggage_friendly
    } = req.body;

    if (!origin || !destination || !ride_date || !start_time) {
      return res.status(400).json({
        success: false,
        message: "Origin, destination, ride_date, and start_time are required."
      });
    }

    const seatsTotalInt = parseInt(seats_total) || 4;
    const priceNum = parseFloat(price_per_seat) || 280;
    const userId = req.user ? req.user.id : null;

    // Fetch user details if authenticated
    let hostName = "Rahul Sharma";
    let hostAvatar = "RS";
    let hostDeptYear = "Computer Science & Engg • '25";

    if (userId) {
      const { data: userProfile } = await supabase
        .from("User_Details")
        .select(`"User Name", email_id`)
        .eq("id", userId)
        .maybeSingle();

      if (userProfile && userProfile["User Name"]) {
        hostName = userProfile["User Name"];
        hostAvatar = hostName.split(" ").map(n => n[0]).join("").toUpperCase();
      }
    }

    const newRideData = {
      user_id: userId,
      host_name: hostName,
      host_avatar: hostAvatar,
      host_dept_year: hostDeptYear,
      origin,
      destination,
      pickup_point: pickup_point || origin,
      drop_point: drop_point || destination,
      category: category || (destination.toLowerCase().includes("airport") ? "airport" : "station"),
      ride_date,
      start_time,
      end_time: end_time || null,
      vehicle_type: vehicle_type || "Cab (Sedan/SUV)",
      seats_total: seatsTotalInt,
      seats_left: seatsTotalInt - 1,
      price_per_seat: priceNum,
      comments: comments || "",
      is_baggage_friendly: is_baggage_friendly !== undefined ? is_baggage_friendly : true,
      status: "active"
    };

    const { data, error } = await supabase
      .from("cab_sharing_rides")
      .insert([newRideData])
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      message: "Cab ride published successfully!",
      ride: data
    });
  } catch (err) {
    console.error("Error creating cab ride:", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// =====================================
// RESERVE / JOIN A SEAT
// POST /api/cab-sharing/rides/:id/join
// =====================================
export const joinRide = async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch current ride
    const { data: ride, error: fetchErr } = await supabase
      .from("cab_sharing_rides")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !ride) {
      return res.status(404).json({ success: false, message: "Cab ride not found." });
    }

    if (ride.seats_left <= 0) {
      return res.status(400).json({ success: false, message: "No available seats remaining." });
    }

    // Decrement available seats
    const newSeatsLeft = ride.seats_left - 1;

    const { data: updatedRide, error: updateErr } = await supabase
      .from("cab_sharing_rides")
      .update({ seats_left: newSeatsLeft })
      .eq("id", id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Optional: Log booking in cab_sharing_bookings table if it exists
    if (req.user && req.user.id) {
      await supabase.from("cab_sharing_bookings").insert([{
        ride_id: id,
        user_id: req.user.id,
        passenger_name: req.user.name || "Student Passenger",
        passenger_role: "Confirmed"
      }]).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: "Seat reserved successfully!",
      ride: updatedRide
    });
  } catch (err) {
    console.error("Error joining cab ride:", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// =====================================
// GET MY RIDES
// GET /api/cab-sharing/my-rides
// =====================================
export const getMyRides = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;

    if (!userId) {
      return res.status(200).json({ success: true, rides: [] });
    }

    const { data, error } = await supabase
      .from("cab_sharing_rides")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      rides: data || []
    });
  } catch (err) {
    console.error("Error fetching my rides:", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};
