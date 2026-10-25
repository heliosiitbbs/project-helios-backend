-- Visit details for "Visitor" accounts (one row per visitor account).
-- The visitor can use the app only between entry_start and entry_end.
-- User_Details.expiry_date is set to entry_end as well, so the nightly expiry job
-- archives and removes the account afterwards; this row goes with it (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS "Visitor_Details" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL UNIQUE REFERENCES "User_Details"(id) ON DELETE CASCADE,
  entry_start timestamptz NOT NULL,
  entry_end timestamptz NOT NULL,
  campus_contact text NOT NULL,
  purpose text NOT NULL,
  added_by bigint,                -- User_Details.id of the Super Admin who added the visitor
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (entry_end > entry_start)
);

NOTIFY pgrst, 'reload schema';
