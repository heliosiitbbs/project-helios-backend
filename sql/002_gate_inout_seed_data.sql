-- Seed data for the Gate In/Out system, so the admin-frontend page has
-- something to show before the guard-facing app exists.
--
-- Prerequisites (run these first, or this script will fail):
--   1. 001_gate_inout_system.sql has been run (tables + "Security Guard" enum value exist).
--   2. Student_Details has at least 4 rows (the student entries below pull real
--      roll numbers from it so the name/hostel/room columns actually resolve).
--   3. At least one User_Details row exists with "User Type" IN
--      ('Security Guard', 'Admin', 'Super Admin') -- used to fill gate_sessions.guard_id.
--      If no 'Security Guard' account exists yet, this falls back to an
--      Admin/Super Admin account so you can seed data before creating one;
--      swap in the real guard's id later if it matters for your testing.
--
-- Safe to run more than once -- each run adds another batch of rows (no
-- uniqueness constraint stops duplicates). Use the cleanup query at the
-- bottom to remove just this seed data.

-- Resolves to a Security Guard if one exists, else falls back to any Admin/Super Admin.
-- Fails loudly (NOT NULL violation) if neither exists -- create at least one such account first.

-- ============================================================
-- Sessions
-- ============================================================

-- Student-out session, 3 hours ago, closed ~15 min later
INSERT INTO gate_sessions (direction, vehicle_number, visiting_location, guard_id, opened_at, closed_at)
SELECT 'student_out', 'KA-01-AB-1234', 'City Mall',
       COALESCE(
         (SELECT id FROM "User_Details" WHERE "User Type" = 'Security Guard' LIMIT 1),
         (SELECT id FROM "User_Details" WHERE "User Type" IN ('Admin', 'Super Admin') LIMIT 1)
       ),
       now() - interval '3 hours', now() - interval '2 hours 45 minutes';

-- Student-out session, yesterday
INSERT INTO gate_sessions (direction, vehicle_number, visiting_location, guard_id, opened_at, closed_at)
SELECT 'student_out', 'KA-02-CD-5678', 'Railway Station',
       COALESCE(
         (SELECT id FROM "User_Details" WHERE "User Type" = 'Security Guard' LIMIT 1),
         (SELECT id FROM "User_Details" WHERE "User Type" IN ('Admin', 'Super Admin') LIMIT 1)
       ),
       now() - interval '1 day 4 hours', now() - interval '1 day 3 hours 40 minutes';

-- Guest-in session, this morning
INSERT INTO gate_sessions (direction, vehicle_number, visiting_location, guard_id, opened_at, closed_at)
SELECT 'guest_in', 'KA-03-EF-9012', 'Guest House',
       COALESCE(
         (SELECT id FROM "User_Details" WHERE "User Type" = 'Security Guard' LIMIT 1),
         (SELECT id FROM "User_Details" WHERE "User Type" IN ('Admin', 'Super Admin') LIMIT 1)
       ),
       now() - interval '5 hours', now() - interval '4 hours 50 minutes';

-- Guest-in session, on foot (no vehicle), 2 days ago -- tests the "optional vehicle" case
INSERT INTO gate_sessions (direction, vehicle_number, visiting_location, guard_id, opened_at, closed_at)
SELECT 'guest_in', NULL, 'Admin Block',
       COALESCE(
         (SELECT id FROM "User_Details" WHERE "User Type" = 'Security Guard' LIMIT 1),
         (SELECT id FROM "User_Details" WHERE "User Type" IN ('Admin', 'Super Admin') LIMIT 1)
       ),
       now() - interval '2 days', now() - interval '2 days' + interval '20 minutes';

-- ============================================================
-- Student entries (real roll numbers pulled from Student_Details)
-- ============================================================

-- Student A: out via session 1, already returned
INSERT INTO gate_entries (session_id, person_type, student_roll_number, out_time, in_time)
SELECT (SELECT id FROM gate_sessions WHERE vehicle_number = 'KA-01-AB-1234'),
       'student', "Roll Number", now() - interval '3 hours', now() - interval '1 hour'
FROM "Student_Details" ORDER BY "Roll Number" LIMIT 1;

-- Student B: out via session 1, NOT returned yet
INSERT INTO gate_entries (session_id, person_type, student_roll_number, out_time, in_time)
SELECT (SELECT id FROM gate_sessions WHERE vehicle_number = 'KA-01-AB-1234'),
       'student', "Roll Number", now() - interval '3 hours', NULL
FROM "Student_Details" ORDER BY "Roll Number" OFFSET 1 LIMIT 1;

-- Student C: out via session 2 (yesterday), returned
INSERT INTO gate_entries (session_id, person_type, student_roll_number, out_time, in_time)
SELECT (SELECT id FROM gate_sessions WHERE vehicle_number = 'KA-02-CD-5678'),
       'student', "Roll Number", now() - interval '1 day 4 hours', now() - interval '1 day 2 hours'
FROM "Student_Details" ORDER BY "Roll Number" OFFSET 2 LIMIT 1;

-- Student D: out via session 2 (yesterday), still NOT returned -- overdue, good for testing the "not returned" filter
INSERT INTO gate_entries (session_id, person_type, student_roll_number, out_time, in_time)
SELECT (SELECT id FROM gate_sessions WHERE vehicle_number = 'KA-02-CD-5678'),
       'student', "Roll Number", now() - interval '1 day 4 hours', NULL
FROM "Student_Details" ORDER BY "Roll Number" OFFSET 3 LIMIT 1;

-- ============================================================
-- Guest entries
-- ============================================================

-- Guest 1: in via session 3 (vehicle), already left
INSERT INTO gate_entries (session_id, person_type, guest_name, guest_phone, guest_purpose, out_time, in_time)
SELECT (SELECT id FROM gate_sessions WHERE vehicle_number = 'KA-03-EF-9012'),
       'guest', 'Ramesh Gupta', '9876543210', 'Meeting Dean of Students',
       now() - interval '2 hours', now() - interval '5 hours';

-- Guest 2: in via session 3, still on campus
INSERT INTO gate_entries (session_id, person_type, guest_name, guest_phone, guest_purpose, out_time, in_time)
SELECT (SELECT id FROM gate_sessions WHERE vehicle_number = 'KA-03-EF-9012'),
       'guest', 'Priya Nair', '9876500000', 'Visiting Mahanadi Hostel',
       NULL, now() - interval '5 hours';

-- Guest 3: in on foot via session 4 (2 days ago), still on campus -- stale, good for testing "still on campus" filter
INSERT INTO gate_entries (session_id, person_type, guest_name, guest_phone, guest_purpose, out_time, in_time)
SELECT (SELECT id FROM gate_sessions WHERE visiting_location = 'Admin Block' AND vehicle_number IS NULL),
       'guest', 'Suresh Rao', '9123456789', 'Vendor - Admin Block',
       NULL, now() - interval '2 days';

-- ============================================================
-- Verify
-- ============================================================
-- SELECT ge.*, gs.vehicle_number, gs.visiting_location, gs.direction
-- FROM gate_entries ge JOIN gate_sessions gs ON gs.id = ge.session_id
-- ORDER BY ge.created_at DESC;

-- ============================================================
-- Cleanup (run manually when you're ready to remove this seed data)
-- ============================================================
-- DELETE FROM gate_entries WHERE session_id IN (
--   SELECT id FROM gate_sessions WHERE vehicle_number IN
--     ('KA-01-AB-1234', 'KA-02-CD-5678', 'KA-03-EF-9012')
--   OR (vehicle_number IS NULL AND visiting_location = 'Admin Block')
-- );
-- DELETE FROM gate_sessions WHERE vehicle_number IN
--   ('KA-01-AB-1234', 'KA-02-CD-5678', 'KA-03-EF-9012')
--   OR (vehicle_number IS NULL AND visiting_location = 'Admin Block');
