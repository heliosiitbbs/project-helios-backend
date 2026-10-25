import supabase from "../config/Supabase.js";
import { sendPushToAll, formatDay, todayOnCampus } from "../utils/pushNotifications.js";

// Parses a Postgres "time with time zone" string (e.g. "08:00:00+00") into
// a decimal hour (e.g. 8.5 for 8:30) so the frontend can position it on a
// vertical timeline without re-parsing time strings itself.
const parseTimeToHour = (timeString) => {
  if (!timeString) return null;
  const match = timeString.match(/^(\d{2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) + Number(match[2]) / 60;
};

// Roll number format: [A/S admission letter, MS(R) and PhD only] + YY + branch code (2) + course code (2) + sequence,
// e.g. "22CS01031" -> year 22, branch "CS", course "01", sequence "031"; "A22CE09017" -> PhD Civil
// Course name and branch names must match courses.name / branches.name exactly (the curriculum lookup is by name)
const PROGRAMMES = {
  "01": {
    course: "B.Tech",
    branches: {
      CS: "Computer Science and Engineering",
      EC: "Electronics and Communication Engineering",
      EE: "Electrical Engineering",
      ME: "Mechanical Engineering",
      CE: "Civil Engineering",
      EP: "Engineering Physics",
      MM: "Metallurgical and Materials Engineering",
      MC: "Mathematics and Computing"
    }
  },
  // Dual CE and ME rolls don't say which of the three M.Tech specialisations the student is in,
  // so those fall back to the parent B.Tech branch (see DUAL_FALLBACK)
  "02": {
    course: "Dual Degree",
    branches: {
      CS: "Computer Science & Engineering",
      EE: "EE Power Electronics & Drives",
      MM: "Metallurgical & Materials Engineering"
    }
  },
  "03": { course: "ITEP", branches: { HS: "Economics", CY: "Chemistry", PH: "Physics", MA: "Mathematics" } },
  "05": { course: "M.Sc", branches: { CY: "Chemistry", PH: "Physics", MA: "Mathematics", GG: "Geology", CL: "Atmosphere & Ocean Sciences" } },
  "06": {
    course: "M.Tech",
    branches: {
      CS: "Computer Science & Engineering",
      AI: "Artificial Intelligence",
      SP: "Signal Processing & Communication Engineering",
      SC: "Semiconductor Technology & Chip Design",
      PD: "Power Electronics & Drives",
      PS: "Power System Engineering",
      EV: "Environmental Engineering",
      GT: "Geotechnical Engineering",
      SE: "Structural Engineering",
      TE: "Transportation Engineering",
      WR: "Water Resources Engineering",
      SD: "Mechanical Systems Design",
      TS: "Thermal Science & Engineering",
      MF: "Manufacturing Engineering",
      RA: "Robotics & Artificial Intelligence",
      MM: "Metallurgical & Materials Engineering",
      CL: "Climate Science & Technology"
    }
  },
  "08": {
    course: "M.S. by Research",
    branches: {
      CS: "Computer Science & Engineering",
      EE: "Electrical Engineering",
      EC: "Electronics & Communication Engineering",
      CE: "Civil Engineering",
      MM: "Metallurgical & Materials Engineering",
      ME: "Mechanical Engineering"
    }
  },
  "09": {
    course: "Ph.D.",
    branches: {
      BS: "Bio-Sciences",
      CY: "Chemistry",
      PH: "Physics",
      MA: "Mathematics",
      AO: "Climate Sciences",
      GG: "Geosciences",
      ES: "Geosciences",
      CS: "Computer Science & Engineering",
      EE: "Electrical Engineering",
      EC: "Electronics & Communication Engineering",
      CE: "Civil Engineering",
      MM: "Metallurgical & Materials Engineering",
      ME: "Mechanical Engineering",
      EM: "Economics",
      EN: "English",
      PY: "Psychology",
      PL: "Philosophy"
    }
  }
};

const DUAL_FALLBACK = { CE: "Civil Engineering", ME: "Mechanical Engineering" };

const parseRollNumber = (rollNumber) => {
  const match = String(rollNumber || "").toUpperCase().match(/^[A-Z]?(\d{2})([A-Z]{2})(\d{2})(\d+)$/);
  if (!match) return null;
  return {
    admissionYear: match[1],
    branchCode: match[2],
    courseCode: match[3],
    sequence: match[4]
  };
};

// { courseName, branchName } for a parsed roll number, or null if the programme/branch isn't known
const resolveProgramme = ({ courseCode, branchCode }) => {
  const programme = PROGRAMMES[courseCode];
  const branchName = programme?.branches[branchCode];
  if (branchName) return { courseName: programme.course, branchName };
  if (courseCode === "02" && DUAL_FALLBACK[branchCode]) {
    return { courseName: PROGRAMMES["01"].course, branchName: DUAL_FALLBACK[branchCode] };
  }
  return null;
};

// Academic year fallback for brand new registrations - only used if the
// student has no existing registration row this semester to copy Year from.
const getDefaultAcademicYear = () => {
  const now = new Date();
  const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
};

// Shared by getMyCurriculum and updateMySubjectSelections: resolves the
// student's course/branch (from their roll number) and current semester
// (from Student_Details). On failure it writes the error response itself
// and returns null, so callers just need `if (!context) return;`.
const resolveStudentContext = async (req, res) => {
  const rollNumber = req.user.rollnumber;

  if (!rollNumber) {
    res.status(400).json({ success: false, message: "Roll number not found in token" });
    return null;
  }

  const parsed = parseRollNumber(rollNumber);
  if (!parsed) {
    res.status(400).json({ success: false, message: "Could not parse roll number" });
    return null;
  }

  const programme = resolveProgramme(parsed);

  if (!programme) {
    res.status(400).json({
      success: false,
      message: `Could not determine course/branch from roll number (course code "${parsed.courseCode}", branch code "${parsed.branchCode}")`
    });
    return null;
  }

  const { courseName, branchName } = programme;

  const { data: studentRow, error: studentError } = await supabase
    .from("Student_Details")
    .select("current_semester")
    .eq("User_code", req.user.id)
    .maybeSingle();

  if (studentError) {
    console.error(studentError);
    res.status(500).json({ success: false, message: "Error fetching student details" });
    return null;
  }

  if (!studentRow) {
    res.status(404).json({ success: false, message: "Student details not found" });
    return null;
  }

  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("*")
    .eq("name", courseName)
    .maybeSingle();

  if (courseError) {
    console.error(courseError);
    res.status(500).json({ success: false, message: "Error fetching course" });
    return null;
  }

  if (!course) {
    res.status(404).json({ success: false, message: `Course "${courseName}" not found` });
    return null;
  }

  const { data: branch, error: branchError } = await supabase
    .from("branches")
    .select("*")
    .eq("course_id", course.id)
    .eq("name", branchName)
    .maybeSingle();

  if (branchError) {
    console.error(branchError);
    res.status(500).json({ success: false, message: "Error fetching branch" });
    return null;
  }

  if (!branch) {
    res.status(404).json({ success: false, message: `Branch "${branchName}" not found for course "${courseName}"` });
    return null;
  }

  return {
    rollNumber,
    courseName,
    branchName,
    courseId: course.id,
    branchId: branch.id,
    currentSemester: studentRow.current_semester
  };
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

    // The timetable itself is a recurring weekly schedule with no dates, so
    // calendar-specific off days (declared holidays, not just Sat/Sun) are
    // handed back separately for the frontend to check actual dates against.
    // Fetched up front so it's included on every response path below, even
    // when the student has no registered subjects yet.
    const { data: holidays, error: holidaysError } = await supabase
      .from("Holiday_List")
      .select("occasion, start_date, end_date");

    if (holidaysError) {
      console.error(holidaysError);
      return res.status(500).json({
        success: false,
        message: "Error fetching holiday list"
      });
    }

    // Step 2: subjects this student registered for in their current semester
    const { data: registrations, error: regError } = await supabase
      .from("Subject_Registrations")
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
        timetable: [],
        holidays: holidays || []
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
      timetable,
      holidays: holidays || []
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server Error"
    });
  }
};

// Returns this semester's curriculum slots (compulsory + lateral) for the
// student's course/branch, each with its valid subject options and whichever
// option (if any) the student already has registered for that slot.
export const getMyCurriculum = async (req, res) => {
  try {
    const context = await resolveStudentContext(req, res);
    if (!context) return;

    const { rollNumber, courseName, branchName, branchId, currentSemester } = context;

    const { data: slots, error: slotsError } = await supabase
      .from("curriculum_slots")
      .select("*")
      .eq("branch_id", branchId)
      .eq("semester", currentSemester)
      .order("id");

    if (slotsError) {
      console.error(slotsError);
      return res.status(500).json({ success: false, message: "Error fetching curriculum slots" });
    }

    if (!slots || slots.length === 0) {
      return res.status(200).json({
        success: true,
        course: courseName,
        branch: branchName,
        semester: currentSemester,
        slots: []
      });
    }

    const slotIds = slots.map((s) => s.id);

    const { data: options, error: optionsError } = await supabase
      .from("curriculum_slot_options")
      .select("*")
      .in("slot_id", slotIds);

    if (optionsError) {
      console.error(optionsError);
      return res.status(500).json({ success: false, message: "Error fetching slot options" });
    }

    const subjectCodes = [...new Set((options || []).map((o) => o.subject_code))];

    const { data: subjects, error: subjectsError } = await supabase
      .from("Subject_Details")
      .select("*")
      .in("subject_code", subjectCodes);

    if (subjectsError) {
      console.error(subjectsError);
      return res.status(500).json({ success: false, message: "Error fetching subject details" });
    }

    const subjectByCode = {};
    (subjects || []).forEach((s) => {
      subjectByCode[s.subject_code] = s;
    });

    const { data: registrations, error: regError } = await supabase
      .from("Subject_Registrations")
      .select("*")
      .eq("student_id", rollNumber)
      .eq("semester", currentSemester);

    if (regError) {
      console.error(regError);
      return res.status(500).json({ success: false, message: "Error fetching subject registrations" });
    }

    const registeredCodes = new Set((registrations || []).map((r) => r["subject code"]));

    const optionsBySlot = {};
    (options || []).forEach((o) => {
      if (!optionsBySlot[o.slot_id]) optionsBySlot[o.slot_id] = [];
      optionsBySlot[o.slot_id].push({
        subject_code: o.subject_code,
        subject_name: subjectByCode[o.subject_code]?.subject_name || o.subject_code,
        credits: subjectByCode[o.subject_code]?.credits ?? null
      });
    });

    const resultSlots = slots.map((slot) => {
      const slotOptions = optionsBySlot[slot.id] || [];
      const registeredOption = slotOptions.find((opt) => registeredCodes.has(opt.subject_code));
      // Compulsory slots have exactly one option and aren't a real choice,
      // so show it as selected even before it's been registered.
      const selected =
        registeredOption?.subject_code ??
        (slot.slot_type === "compulsory" ? slotOptions[0]?.subject_code ?? null : null);

      return {
        slot_id: slot.id,
        slot_type: slot.slot_type,
        slot_label: slot.slot_label,
        options: slotOptions,
        selected_subject_code: selected
      };
    });

    return res.status(200).json({
      success: true,
      course: courseName,
      branch: branchName,
      semester: currentSemester,
      slots: resultSlots
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// Saves the student's chosen subject for one or more lateral slots. Body:
// { selections: { "<slot_id>": "<subject_code>", ... } }
// Compulsory slots are not editable through this endpoint.
export const updateMySubjectSelections = async (req, res) => {
  try {
    const context = await resolveStudentContext(req, res);
    if (!context) return;

    const { rollNumber, branchId, currentSemester } = context;
    const { selections } = req.body;

    if (!selections || typeof selections !== "object" || Array.isArray(selections)) {
      return res.status(400).json({
        success: false,
        message: "selections must be an object of { slot_id: subject_code }"
      });
    }

    const slotIds = Object.keys(selections)
      .map(Number)
      .filter((n) => !Number.isNaN(n));

    if (slotIds.length === 0) {
      return res.status(400).json({ success: false, message: "No valid slot selections provided" });
    }

    const { data: slots, error: slotsError } = await supabase
      .from("curriculum_slots")
      .select("*")
      .in("id", slotIds)
      .eq("branch_id", branchId)
      .eq("semester", currentSemester);

    if (slotsError) {
      console.error(slotsError);
      return res.status(500).json({ success: false, message: "Error fetching curriculum slots" });
    }

    const slotById = {};
    (slots || []).forEach((s) => {
      slotById[s.id] = s;
    });

    // Every requested slot must belong to this student's own curriculum,
    // and only lateral slots are student-editable.
    for (const slotId of slotIds) {
      const slot = slotById[slotId];
      if (!slot) {
        return res.status(400).json({ success: false, message: `Slot ${slotId} is not part of your curriculum` });
      }
      if (slot.slot_type !== "lateral") {
        return res.status(400).json({ success: false, message: `Slot ${slotId} is compulsory and cannot be changed` });
      }
    }

    const { data: options, error: optionsError } = await supabase
      .from("curriculum_slot_options")
      .select("*")
      .in("slot_id", slotIds);

    if (optionsError) {
      console.error(optionsError);
      return res.status(500).json({ success: false, message: "Error fetching slot options" });
    }

    const optionCodesBySlot = {};
    (options || []).forEach((o) => {
      if (!optionCodesBySlot[o.slot_id]) optionCodesBySlot[o.slot_id] = [];
      optionCodesBySlot[o.slot_id].push(o.subject_code);
    });

    for (const slotId of slotIds) {
      const chosenCode = selections[slotId];
      const validCodes = optionCodesBySlot[slotId] || [];
      if (!validCodes.includes(chosenCode)) {
        return res.status(400).json({
          success: false,
          message: `"${chosenCode}" is not a valid option for slot ${slotId}`
        });
      }
    }

    const { data: existingRegistrations, error: regFetchError } = await supabase
      .from("Subject_Registrations")
      .select("*")
      .eq("student_id", rollNumber)
      .eq("semester", currentSemester);

    if (regFetchError) {
      console.error(regFetchError);
      return res.status(500).json({ success: false, message: "Error fetching existing registrations" });
    }

    const academicYear = existingRegistrations?.[0]?.Year || getDefaultAcademicYear();

    for (const slotId of slotIds) {
      const chosenCode = selections[slotId];
      const validCodes = optionCodesBySlot[slotId] || [];
      const staleRows = (existingRegistrations || []).filter((r) => validCodes.includes(r["subject code"]));

      const alreadyCorrect = staleRows.length === 1 && staleRows[0]["subject code"] === chosenCode;
      if (alreadyCorrect) continue;

      if (staleRows.length > 0) {
        const { error: deleteError } = await supabase
          .from("Subject_Registrations")
          .delete()
          .in("id", staleRows.map((r) => r.id));

        if (deleteError) {
          console.error(deleteError);
          return res.status(500).json({ success: false, message: "Error clearing previous selection" });
        }
      }

      const { error: insertError } = await supabase.from("Subject_Registrations").insert([
        {
          student_id: rollNumber,
          "subject code": chosenCode,
          Year: academicYear,
          semester: currentSemester
        }
      ]);

      if (insertError) {
        console.error(insertError);
        return res.status(500).json({ success: false, message: "Error saving new selection" });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Subject selections updated successfully"
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Admin: list every declared holiday (Time Table Admin manages this list).
export const getAllHolidays = async (req, res) => {
  try {
    const { data: holidays, error } = await supabase
      .from("Holiday_List")
      .select("*")
      .order("start_date");

    if (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: "Error fetching holiday list" });
    }

    return res.status(200).json({ success: true, holidays: holidays || [] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// Admin: add a holiday (or holiday range) to Holiday_List.
// Everyone hears about upcoming holidays being declared or called off (fire-and-forget)
const notifyHoliday = (holiday, change) => {
  if (holiday.end_date < todayOnCampus()) return;
  const single = holiday.start_date === holiday.end_date;
  const when = single
    ? formatDay(holiday.start_date)
    : `${formatDay(holiday.start_date)} – ${formatDay(holiday.end_date)}`;
  const payload = change === "added"
    ? {
        title: "Holiday declared",
        body: `${when} ${single ? "is" : "are"} declared ${single ? "a holiday" : "holidays"} for ${holiday.occasion}.`
      }
    : {
        title: "Holiday cancelled",
        body: `${when} ${single ? "is" : "are"} no longer ${single ? "a holiday" : "holidays"} (${holiday.occasion}). Classes run as usual.`
      };
  sendPushToAll({ ...payload, type: "timetable", data: { screen: "TimeTable" } })
    .catch((err) => console.error("Failed to send holiday push", err));
};

export const addHoliday = async (req, res) => {
  try {
    const { occasion, start_date, end_date } = req.body;

    if (!occasion || !occasion.trim() || !start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: "occasion, start_date and end_date are required"
      });
    }

    if (!DATE_REGEX.test(start_date) || !DATE_REGEX.test(end_date)) {
      return res.status(400).json({
        success: false,
        message: "start_date and end_date must be in YYYY-MM-DD format"
      });
    }

    if (end_date < start_date) {
      return res.status(400).json({
        success: false,
        message: "end_date cannot be before start_date"
      });
    }

    const { data: holiday, error } = await supabase
      .from("Holiday_List")
      .insert([{ occasion: occasion.trim(), start_date, end_date }])
      .select()
      .single();

    if (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: "Error adding holiday" });
    }

    notifyHoliday(holiday, "added");

    return res.status(200).json({
      success: true,
      message: "Holiday added successfully",
      holiday
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// Admin: remove a holiday by id.
export const deleteHoliday = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: deleted, error } = await supabase
      .from("Holiday_List")
      .delete()
      .eq("id", id)
      .select();

    if (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: "Error deleting holiday" });
    }

    if (!deleted || deleted.length === 0) {
      return res.status(404).json({ success: false, message: "Holiday not found" });
    }

    notifyHoliday(deleted[0], "removed");

    return res.status(200).json({ success: true, message: "Holiday deleted successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};


