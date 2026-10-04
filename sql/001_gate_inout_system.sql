-- Gate In/Out (security guard) system
-- Run in Supabase SQL editor. After running, reload the schema cache:
-- Supabase dashboard -> Settings -> API -> "Reload schema cache"
-- (or the NOTIFY at the bottom of this file does it for you).

-- ============================================================
-- STEP 0: find the enum type backing User_Details."User Type"
-- Run this first and read the result before step 1 -- the
-- generated type name varies depending on how the column/enum
-- was originally created.
-- ============================================================
-- SELECT udt_name FROM information_schema.columns
-- WHERE table_name = 'User_Details' AND column_name = 'User Type';

-- ============================================================
-- STEP 1: add the new role.
-- Replace <enum_type_name> with the udt_name from Step 0.
-- Must run as its own statement (not combined with anything
-- that reads/writes the new value in the same transaction).
-- ============================================================
-- ALTER TYPE <enum_type_name> ADD VALUE IF NOT EXISTS 'Security Guard';

-- ============================================================
-- STEP 2: gate_sessions -- one row per guard batch.
-- direction = 'student_out'  -> guard is sending a group of students out
--             (vehicle/visiting_location captured here; each entry's
--              out_time is stamped when the entry is created)
-- direction = 'guest_in'     -> guard is letting a group of guests onto
--              campus (vehicle/visiting_location captured here; each
--              entry's in_time is stamped when the entry is created)
-- The "closing" side of each entry (a student returning, a guest leaving)
-- is a bare scan with no session -- see gate_entries below.
-- ============================================================
CREATE TABLE gate_sessions (
  id bigint generated always as identity primary key,
  direction text NOT NULL CHECK (direction IN ('student_out', 'guest_in')),
  vehicle_number text,
  visiting_location text,
  guard_id bigint NOT NULL, -- User_Details.id of the guard who opened this session (no hard FK, matches existing convention)
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_gate_sessions_guard ON gate_sessions(guard_id);

-- ============================================================
-- STEP 3: gate_entries -- one row per person per full in/out cycle.
-- ============================================================
CREATE TABLE gate_entries (
  id bigint generated always as identity primary key,
  session_id bigint NOT NULL REFERENCES gate_sessions(id),
  person_type text NOT NULL CHECK (person_type IN ('student', 'guest')),

  -- populated when person_type = 'student'
  student_roll_number text, -- matches Student_Details."Roll Number" (no hard FK, matches existing convention)

  -- populated when person_type = 'guest'
  guest_name text,
  guest_phone text,
  guest_purpose text, -- who/why they're visiting

  out_time timestamptz, -- students: stamped at creation. guests: stamped on the closing scan.
  in_time timestamptz,  -- guests: stamped at creation. students: stamped on the closing scan.

  closed_by_guard_id bigint, -- guard who performed the closing scan, if different session

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT gate_entries_person_fields_check CHECK (
    (person_type = 'student' AND student_roll_number IS NOT NULL AND guest_name IS NULL AND guest_phone IS NULL)
    OR
    (person_type = 'guest' AND guest_name IS NOT NULL AND student_roll_number IS NULL)
  )
);

CREATE INDEX idx_gate_entries_session ON gate_entries(session_id);
CREATE INDEX idx_gate_entries_roll_number ON gate_entries(student_roll_number);

-- fast lookup for "find the open record to close" on a return/exit scan
CREATE INDEX idx_gate_entries_open_students ON gate_entries(student_roll_number)
  WHERE person_type = 'student' AND in_time IS NULL;
CREATE INDEX idx_gate_entries_open_guests ON gate_entries(guest_phone)
  WHERE person_type = 'guest' AND out_time IS NULL;

NOTIFY pgrst, 'reload schema';
