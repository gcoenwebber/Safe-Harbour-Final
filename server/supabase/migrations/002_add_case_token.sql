-- Migration: Add case_token to reports table
-- Description: Adds a unique case token for anonymous report tracking

-- Add case_token column to reports table
ALTER TABLE reports ADD COLUMN IF NOT EXISTS case_token CHAR(19) UNIQUE;

-- Create index for fast lookups by case_token
CREATE INDEX IF NOT EXISTS idx_reports_case_token ON reports(case_token);

-- Add interim_relief column to store relief requests
ALTER TABLE reports ADD COLUMN IF NOT EXISTS interim_relief TEXT[];

-- Add incident_type enum and column
DO $$ BEGIN
    CREATE TYPE incident_type AS ENUM ('physical', 'verbal', 'psychological');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS incident_type incident_type;
