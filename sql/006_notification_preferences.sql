-- Per-user notification toggles (Settings -> Notification Settings in the app).
-- No row for a user means everything is on. all_enabled is the master switch;
-- the other three map to push "type"s in utils/pushNotifications.js (NOTIFICATION_CATEGORY).

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id bigint PRIMARY KEY,                    -- User_Details.id (no hard FK, matches existing convention)
  all_enabled boolean NOT NULL DEFAULT true,
  applied boolean NOT NULL DEFAULT true,         -- grievances, lost & found, rides, bug reports, timetable
  mess_transport boolean NOT NULL DEFAULT true,  -- mess and bus updates
  oracle boolean NOT NULL DEFAULT true,          -- ORACLE news posts
  updated_at timestamptz NOT NULL DEFAULT now()
);

NOTIFY pgrst, 'reload schema';
