-- Who uploaded each ARP paper, so they can be told when it's accepted or rejected.
-- contributor_name stays as the display name the student typed; older rows keep this null.
ALTER TABLE paper_details ADD COLUMN IF NOT EXISTS contributor_user_id bigint;

NOTIFY pgrst, 'reload schema';
