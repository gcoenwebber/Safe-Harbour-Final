-- Migration: Update enquiry_messages for Socket.io Chat
-- Description: Adds case_token-based access and new columns for anonymous chat

-- First, ensure reports table has case_token column
ALTER TABLE reports ADD COLUMN IF NOT EXISTS case_token CHAR(19) UNIQUE;
CREATE INDEX IF NOT EXISTS idx_reports_case_token ON reports(case_token);

-- Add interim_relief column if not exists
ALTER TABLE reports ADD COLUMN IF NOT EXISTS interim_relief TEXT[];

-- Add incident_type enum and column if not exists
DO $$ BEGIN
    CREATE TYPE incident_type AS ENUM ('physical', 'verbal', 'psychological');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS incident_type incident_type;

-- Update enquiry_messages table structure for Socket.io chat
-- Add case_token column (for direct token-based access)
ALTER TABLE enquiry_messages ADD COLUMN IF NOT EXISTS case_token CHAR(19);

-- Add sender_type column (for distinguishing reviewer/victim)
ALTER TABLE enquiry_messages ADD COLUMN IF NOT EXISTS sender_type VARCHAR(20);

-- Add display_name column (for anonymous display)
ALTER TABLE enquiry_messages ADD COLUMN IF NOT EXISTS display_name VARCHAR(50);

-- Rename message_content to content if exists (to match new schema)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'enquiry_messages' AND column_name = 'message_content') THEN
        ALTER TABLE enquiry_messages RENAME COLUMN message_content TO content;
    END IF;
END $$;

-- Add content column if it doesn't exist
ALTER TABLE enquiry_messages ADD COLUMN IF NOT EXISTS content TEXT;

-- Make report_id nullable (since we now use case_token for access)
ALTER TABLE enquiry_messages ALTER COLUMN report_id DROP NOT NULL;

-- Create index for fast lookup by case_token
CREATE INDEX IF NOT EXISTS idx_enquiry_messages_case_token ON enquiry_messages(case_token);
CREATE INDEX IF NOT EXISTS idx_enquiry_messages_created ON enquiry_messages(case_token, created_at ASC);

-- Drop old RLS policies if they exist
DROP POLICY IF EXISTS "enquiry_messages_select_policy" ON enquiry_messages;
DROP POLICY IF EXISTS "enquiry_messages_insert_policy" ON enquiry_messages;

-- Enable RLS
ALTER TABLE enquiry_messages ENABLE ROW LEVEL SECURITY;

-- Policy for service role (backend uses service key)
DROP POLICY IF EXISTS "service_role_full_access" ON enquiry_messages;
CREATE POLICY "service_role_full_access" ON enquiry_messages
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Policy for authenticated users to read messages (validated at application level)
CREATE POLICY "enquiry_messages_select_by_token" ON enquiry_messages
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "enquiry_messages_insert_by_token" ON enquiry_messages
    FOR INSERT
    TO authenticated
    WITH CHECK (true);
