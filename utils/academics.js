import supabase from "../config/Supabase.js";

// Roll number format: [A/S admission letter, MS(R) and PhD only] + YY + branch code (2) + course code (2) + sequence,
// e.g. "22CS01031" -> year 22, branch "CS", course "01", sequence "031"; "A22CE09017" -> PhD Civil
// Course name and branch names must match courses.name / branches.name exactly (the curriculum lookup is by name)
export const PROGRAMMES = {
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

export const DUAL_FALLBACK = { CE: "Civil Engineering", ME: "Mechanical Engineering" };

export const parseRollNumber = (rollNumber) => {
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
export const resolveProgramme = ({ courseCode, branchCode }) => {
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
export const getDefaultAcademicYear = () => {
  const now = new Date();
  const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
};

// Course name of a roll number's programme (Dual CE/ME stay "Dual Degree" here, unlike resolveProgramme)
export const programmeName = (rollNumber) => PROGRAMMES[parseRollNumber(rollNumber)?.courseCode]?.course || null;

// ---------- Semester cycles ----------
// Semesters change twice a year: on Dec 18 (odd -> even) and on Jun 30 (even -> odd).
// A cycle is named after that date: "DEC_2026", "JUN_2027".

// Last semester of each taught programme. PhD has none: it ends with the thesis.
export const LAST_SEMESTER = {
  "B.Tech": 8,
  "Dual Degree": 10,
  "ITEP": 8,
  "M.Sc": 4,
  "M.Tech": 4,
  "M.S. by Research": 5
};

const CYCLE_DAY = { JUN: "06-30", DEC: "12-18" };
const CYCLE_RE = /^(JUN|DEC)_(\d{4})$/;

export const cycleDate = (cycle) => {
  const m = CYCLE_RE.exec(String(cycle || ""));
  return m ? new Date(`${m[2]}-${CYCLE_DAY[m[1]]}T00:00:00+05:30`) : null;
};

const nextCycle = (cycle) => {
  const [, kind, year] = CYCLE_RE.exec(cycle);
  return kind === "JUN" ? `DEC_${year}` : `JUN_${Number(year) + 1}`;
};

// The most recent cycle on or before `now`
export const latestCycle = (now = new Date()) => {
  const y = now.getFullYear();
  return [`DEC_${y}`, `JUN_${y}`, `DEC_${y - 1}`].find((c) => cycleDate(c) <= now);
};

// The cycle in which a student moves past their programme's last semester (stored in
// Student_Details.last_promoted_cycle). null for PhD, unknown programmes or no semester.
export const computeFinalCycle = (rollNumber, semester, now = new Date()) => {
  const last = LAST_SEMESTER[programmeName(rollNumber)];
  if (!last || !semester) return null;
  let cycle = latestCycle(now);
  for (let step = 0; step < last - semester + 1; step++) cycle = nextCycle(cycle);
  return cycle;
};

// App access ends two months after the last semester: when the June cycle closes (Jun 30),
// or on Feb 18 after a December one.
export const accessEndsAt = (cycle) => {
  const m = CYCLE_RE.exec(String(cycle || ""));
  if (!m) return null;
  return m[1] === "JUN"
    ? new Date(`${m[2]}-07-01T00:00:00+05:30`)
    : new Date(`${Number(m[2]) + 1}-02-19T00:00:00+05:30`);
};

export const isAccessClosed = (cycle, now = new Date()) => {
  const end = accessEndsAt(cycle);
  return !!end && now >= end;
};

// Semester a roll number's batch is in right now (odd in Jul-Dec, even in Jan-Jun).
// Spring (S) admits are kept with the odd-semester cohort of their year.
export const defaultSemester = (rollNumber, now = new Date()) => {
  const parsed = parseRollNumber(rollNumber);
  if (!parsed) return null;
  const spring = now.getMonth() < 6;
  const startYear = spring ? now.getFullYear() - 1 : now.getFullYear();
  return Math.max(1, (startYear - 2000 - Number(parsed.admissionYear)) * 2 + 1 + (spring ? 1 : 0));
};

// ---------- Core subject registration ----------

// "<course>|<branch>" -> branches.id
const loadBranchIds = async () => {
  const [{ data: courses, error: e1 }, { data: branches, error: e2 }] = await Promise.all([
    supabase.from("courses").select("id, name"),
    supabase.from("branches").select("id, course_id, name")
  ]);
  if (e1 || e2) throw e1 || e2;
  const courseName = Object.fromEntries(courses.map((c) => [c.id, c.name]));
  return Object.fromEntries(branches.map((b) => [`${courseName[b.course_id]}|${b.name}`, b.id]));
};

// Registers the compulsory subjects of each student's semester (same branch the app shows them),
// skipping subjects already registered. students: [{ roll, semester }]. Returns the rows added.
export const registerCoreSubjects = async (students, now = new Date()) => {
  const branchIds = await loadBranchIds();
  const wanted = students
    .map((s) => {
      const programme = resolveProgramme(parseRollNumber(s.roll) || {});
      const branchId = programme && branchIds[`${programme.courseName}|${programme.branchName}`];
      return branchId && s.semester ? { roll: s.roll, semester: s.semester, key: `${branchId}|${s.semester}` } : null;
    })
    .filter(Boolean);
  if (!wanted.length) return 0;

  const coreByKey = {};
  for (const key of new Set(wanted.map((w) => w.key))) {
    const [branchId, semester] = key.split("|").map(Number);
    const { data: slots, error } = await supabase
      .from("curriculum_slots")
      .select("curriculum_slot_options(subject_code)")
      .eq("branch_id", branchId)
      .eq("semester", semester)
      .eq("slot_type", "compulsory");
    if (error) throw error;
    coreByKey[key] = slots.flatMap((s) => s.curriculum_slot_options.map((o) => o.subject_code));
  }

  const have = new Set();
  const rolls = [...new Set(wanted.map((w) => w.roll))];
  for (let i = 0; i < rolls.length; i += 300) {
    const { data, error } = await supabase
      .from("Subject_Registrations")
      .select(`student_id, semester, "subject code"`)
      .in("student_id", rolls.slice(i, i + 300));
    if (error) throw error;
    data.forEach((r) => have.add(`${r.student_id}|${r.semester}|${r["subject code"]}`));
  }

  const year = getDefaultAcademicYear();
  const rows = wanted.flatMap((w) =>
    coreByKey[w.key]
      .filter((code) => !have.has(`${w.roll}|${w.semester}|${code}`))
      .map((code) => ({ student_id: w.roll, "subject code": code, Year: year, semester: w.semester }))
  );
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("Subject_Registrations").insert(rows.slice(i, i + 500));
    if (error) throw error;
  }
  return rows.length;
};
