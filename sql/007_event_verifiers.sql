-- Door-staff accounts for event passes. The Super Admin creates them per event
-- (Credentials -> Verifiers on the admin dashboard); each signs in to the app
-- with a username + random password and can only scan passes for that event.
-- Access starts when the account is created and ends at the event's end_time.
-- Like hostel_staff, these are not User_Details accounts.

CREATE TABLE IF NOT EXISTS event_verifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,          -- event_details.event_id (no hard FK, matches existing convention)
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,     -- bcrypt; the plain password is only shown once, at creation/reset
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_verifiers_event_id_idx ON event_verifiers (event_id);

NOTIFY pgrst, 'reload schema';
