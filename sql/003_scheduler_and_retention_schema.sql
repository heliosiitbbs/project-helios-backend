-- ============================================================
-- SQL Migration 003: Expiry and Retention Management System
-- Run in Supabase SQL editor to support account expiry,
-- automatic cascade deletion of complete student data,
-- and retention cleanup.
-- ============================================================

-- 1. Add expiry_date to User_Details (supports both TIMESTAMPTZ date or BOOLEAN true/false)
ALTER TABLE "User_Details" 
ADD COLUMN IF NOT EXISTS "expiry_date" TIMESTAMPTZ;

-- If you already added expiry_date as BOOLEAN, that works too. If needed as a boolean column:
-- ALTER TABLE "User_Details" ADD COLUMN IF NOT EXISTS "is_expired" BOOLEAN DEFAULT FALSE;

-- Fast index for looking up expired users
CREATE INDEX IF NOT EXISTS idx_user_details_expiry 
ON "User_Details" ("expiry_date");

-- 2. Add resolved_at to lost_and_found_details to track resolution time (for 1-month retention)
ALTER TABLE "lost_and_found_details"
ADD COLUMN IF NOT EXISTS "resolved_at" TIMESTAMPTZ;

-- Backfill resolved_at for any previously resolved items
UPDATE "lost_and_found_details"
SET "resolved_at" = "created_at"
WHERE "is_resolved" = TRUE AND "resolved_at" IS NULL;

CREATE INDEX IF NOT EXISTS idx_lost_found_retention 
ON "lost_and_found_details" ("is_resolved", "resolved_at");

-- 3. Index campus_news by creation date for fast 3-month retention cleanup
CREATE INDEX IF NOT EXISTS idx_campus_news_retention 
ON "campus_news" ("created_at");

-- 4. Create scheduler_logs table for audit trail and monitoring
CREATE TABLE IF NOT EXISTS "scheduler_logs" (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL,
    details JSONB,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduler_logs_executed_at 
ON "scheduler_logs" (executed_at DESC);

-- 5. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
