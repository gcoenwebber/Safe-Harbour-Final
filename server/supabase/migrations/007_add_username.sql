-- Migration: Add username column
-- Description: Add username field for user identification in reports

-- Add username column to public_directory
ALTER TABLE public_directory ADD COLUMN IF NOT EXISTS username VARCHAR(50);

-- Create unique index on username within organization
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_directory_username_org 
ON public_directory(organization_id, LOWER(username))
WHERE username IS NOT NULL;

-- Add username to identity_mapping for quick lookup
ALTER TABLE identity_mapping ADD COLUMN IF NOT EXISTS username VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_identity_mapping_username ON identity_mapping(LOWER(username));
