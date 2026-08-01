import supabase from "../config/Supabase.js";

// Parses a Postgres "time with time zone" string (e.g. "08:00:00+00") into
// a decimal hour (e.g. 8.5 for 8:30) so the frontend can position it on a
// vertical timeline without re-parsing time strings itself.
const parseTimeToHour = (timeString) => {
  if (!timeString) return null;
  const match = timeString.match(/^(\d{2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) + Number(match[2]) / 60;
};

export const getMyTimetable = async (req, res) => {
  try {
    const rollNumber = req.user.rollnumber;

    if (!rollNumber) {
      return res.status(400).json({
        success: false,
        message: "Roll number not found in token"
      });
    }

    // Step 1: the student's current semester decides which registrations are "current"
    const { data: studentRow, error: studentError } = await supabase
      .from("Student_Details")
      .select("current_semester")
      .eq("User_code", req.user.id)
      .maybeSingle();

    if (studentError) {
      console.error(studentError);
      return res.status(500).json({
        success: false,
        message: "Error fetching student details"
      });
    }

    if (!studentRow) {
      return res.status(404).json({
        success: false,
        message: "Student details not found"
      });
    }

    const currentSemester = studentRow.current_semester;

    // Step 2: subjects this student registered for in their current semester
    const { data: registrations, error: regError } = await supabase
      .from("Subject_Regestrations")
      .select("*")
      .eq("student_id", rollNumber)
      .eq("semester", currentSemester);

    if (regError) {
      console.error(regError);
      return res.status(500).json({
        success: false,
        message: "Error fetching subject registrations"
      });
    }

    const subjectCodes = [...new Set((registrations || []).map((r) => r["subject code"]))];

    if (subjectCodes.length === 0) {
      return res.status(200).json({
        success: true,
        semester: currentSemester,
        timetable: []
      });
    }

    // Step 3: subject names and weekly timing slots for those subjects
    const [
      { data: subjects, error: subjectsError },
      { data: timings, error: timingsError }
    ] = await Promise.all([
      supabase.from("Subject_Details").select("*").in("subject_code", subjectCodes),
      supabase.from("Subject_Timings").select("*").in("subject_code", subjectCodes)
    ]);

    if (subjectsError) {
      console.error(subjectsError);
      return res.status(500).json({
        success: false,
        message: "Error fetching subject details"
      });
    }

    if (timingsError) {
      console.error(timingsError);
      return res.status(500).json({
        success: false,
        message: "Error fetching subject timings"
      });
    }

    const subjectByCode = {};
    (subjects || []).forEach((s) => {
      subjectByCode[s.subject_code] = s;
    });

    // Step 4: project timing rows into flat timetable entries the frontend can render directly
    const timetable = (timings || [])
      .filter((t) => subjectByCode[t.subject_code])
      .map((t) => ({
        subject_code: t.subject_code,
        subject_name: subjectByCode[t.subject_code]?.subject_name || t.subject_code,
        credits: subjectByCode[t.subject_code]?.credits ?? null,
        day_of_week: t.day_of_the_week,
        start_time: t.start_time,
        end_time: t.end_time,
        start_hour: parseTimeToHour(t.start_time),
        end_hour: parseTimeToHour(t.end_time),
        location: t.Location
      }));

    return res.status(200).json({
      success: true,
      semester: currentSemester,
      timetable
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server Error"
    });
  }
};
