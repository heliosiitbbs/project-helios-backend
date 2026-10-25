-- Extra visit fields on "Visitor_Details" (carried over from the earlier visitors_details table).
-- They apply to a whole batch of visitors, like the dates, campus contact and purpose.

ALTER TABLE "Visitor_Details"
  ADD COLUMN IF NOT EXISTS visit_type text,       -- Event, Internship, Academic / Department Visit, Official / Business Visit, Other
  ADD COLUMN IF NOT EXISTS destination text,      -- where on campus, e.g. SECS building
  ADD COLUMN IF NOT EXISTS host_contact text,     -- phone or email of the campus contact
  ADD COLUMN IF NOT EXISTS group_name text;       -- event, programme or department the visit belongs to

NOTIFY pgrst, 'reload schema';
