-- Exam timetables (mid-sem / end-sem). The Time Table Admin uploads the exam
-- cell's sheet (SLOT, DATE, TIME, BUILDING, ROOM, COURSE CODE, COURSE NAME,
-- STUDENT COUNT) and picks the exam period; the sheet's day numbers (d1, d2, ...)
-- are placed on the exam days chosen inside that period. Between start_date and
-- end_date the app shows students their exams and seating instead of the weekly
-- class timetable - only students of the programmes in `courses` (all when null),
-- so e.g. B.Tech/M.Tech can be in exams while M.Sc keeps having classes.

CREATE TABLE IF NOT EXISTS exam_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    exam_days date[] NOT NULL,          -- the dates d1, d2, ... landed on, in order
    courses text[],                     -- programmes it applies to (courses.name, e.g. B.Tech); null = every programme
    file_name text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per course per room (a big course is split across several rooms)
CREATE TABLE IF NOT EXISTS exam_slots (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    schedule_id uuid NOT NULL,
    slot text NOT NULL,                 -- e.g. d1s1, as in the sheet
    exam_date date NOT NULL,
    start_time time NOT NULL,
    end_time time NOT NULL,
    course_code text NOT NULL,
    course_name text,
    building text,
    room text,
    student_count int
);

-- (for databases where the table was created before the courses column existed)
ALTER TABLE exam_schedules ADD COLUMN IF NOT EXISTS courses text[];

CREATE INDEX IF NOT EXISTS exam_slots_schedule_idx ON exam_slots (schedule_id);
CREATE INDEX IF NOT EXISTS exam_slots_course_idx ON exam_slots (course_code);

NOTIFY pgrst, 'reload schema';
