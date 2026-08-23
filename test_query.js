import "dotenv/config";
import supabase from "./config/Supabase.js";

async function run() {
  console.log("Checking exact query from controller...");
  const { data, error } = await supabase
    .from("Student_Details")
    .select(`
      "Roll Number",
      Hostel_Details,
      "Room No",
      "Faculty Adviser",
      User_code,
      User_Details (
        "User Name",
        email_id,
        is_Valid
      )
    `);

  console.log("Error:", error);
  console.log("Data count:", data ? data.length : 0);
  if (data && data.length > 0) {
    console.log("Sample row:", data[0]);
  }
}

run();
