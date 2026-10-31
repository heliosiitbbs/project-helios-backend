-- 1. When each event pass was used, and who scanned it (a verifier's username,
--    or "Door code · <email>" for scans made with the event's door code).
--    Passes used before this existed keep these null.
ALTER TABLE event_passes ADD COLUMN IF NOT EXISTS used_at timestamptz;
ALTER TABLE event_passes ADD COLUMN IF NOT EXISTS used_by text;

-- 2. Hostel staff sign in with the hostel admin's PIN once, then must pick their
--    own password. pin_hash keeps holding whichever one is current.
ALTER TABLE hostel_staff ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Every PIN set so far was chosen by an admin, so those staff change it at their next sign-in
UPDATE hostel_staff SET must_change_password = true WHERE pin_hash IS NOT NULL;

NOTIFY pgrst, 'reload schema';
