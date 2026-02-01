-- Supabase SQL Migration Script
-- Created: 2026-01-31
-- Description: Schema for Safe Harbour reporting system

-- ============================================
-- TABLE: public_directory
-- ============================================
CREATE TABLE IF NOT EXISTS public_directory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uin CHAR(10) NOT NULL UNIQUE CHECK (uin ~ '^\d{10}$'),
    full_name TEXT NOT NULL,
    role TEXT NOT NULL,
    organization_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX idx_public_directory_organization ON public_directory(organization_id);
CREATE INDEX idx_public_directory_uin ON public_directory(uin);

-- ============================================
-- TABLE: identity_mapping
-- ============================================
CREATE TABLE IF NOT EXISTS identity_mapping (
    email_hash TEXT PRIMARY KEY,
    uin CHAR(10) NOT NULL REFERENCES public_directory(uin) ON DELETE CASCADE,
    organization_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for organization lookups
CREATE INDEX idx_identity_mapping_organization ON identity_mapping(organization_id);
CREATE INDEX idx_identity_mapping_uin ON identity_mapping(uin);

-- ============================================
-- TABLE: reports
-- ============================================
CREATE TYPE report_status AS ENUM ('pending', 'investigating', 'resolved');

CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    victim_uin CHAR(10) NOT NULL REFERENCES public_directory(uin),
    subject_uin CHAR(10) NOT NULL REFERENCES public_directory(uin),
    content TEXT NOT NULL,
    status report_status NOT NULL DEFAULT 'pending',
    organization_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

-- Create indexes for faster queries
CREATE INDEX idx_reports_victim_uin ON reports(victim_uin);
CREATE INDEX idx_reports_subject_uin ON reports(subject_uin);
CREATE INDEX idx_reports_organization ON reports(organization_id);
CREATE INDEX idx_reports_status ON reports(status);

-- ============================================
-- TABLE: enquiry_messages
-- ============================================
CREATE TABLE IF NOT EXISTS enquiry_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL,
    message_content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for report lookups
CREATE INDEX idx_enquiry_messages_report ON enquiry_messages(report_id);

-- ============================================
-- ENABLE ROW-LEVEL SECURITY (RLS)
-- ============================================
ALTER TABLE public_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiry_messages ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES: reports
-- ============================================

-- Policy: Users can SELECT reports where:
-- 1. Their UIN matches the victim_uin, OR
-- 2. Their JWT contains a Reviewer role claim for that organization_id
CREATE POLICY "reports_select_policy" ON reports
    FOR SELECT
    USING (
        -- Condition 1: User's UIN matches victim_uin
        -- (UIN is retrieved from identity_mapping using the user's email hash from JWT)
        victim_uin = (
            SELECT uin FROM identity_mapping 
            WHERE email_hash = ((auth.jwt() -> 'app_metadata') ->> 'email_hash')
            LIMIT 1
        )
        OR
        -- Condition 2: User has Reviewer role for this organization
        -- JWT claim structure: { "app_metadata": { "org_roles": { "<organization_id>": "Reviewer" } } }
        (
            ((auth.jwt() -> 'app_metadata') -> 'org_roles') ->> (organization_id::text) = 'Reviewer'
        )
    );

-- Policy: Allow authenticated users to insert reports (as victims)
CREATE POLICY "reports_insert_policy" ON reports
    FOR INSERT
    WITH CHECK (
        victim_uin = (
            SELECT uin FROM identity_mapping 
            WHERE email_hash = ((auth.jwt() -> 'app_metadata') ->> 'email_hash')
            LIMIT 1
        )
    );

-- Policy: Allow Reviewers to update reports for their organization
CREATE POLICY "reports_update_policy" ON reports
    FOR UPDATE
    USING (
        ((auth.jwt() -> 'app_metadata') -> 'org_roles') ->> (organization_id::text) = 'Reviewer'
    );

-- ============================================
-- RLS POLICIES: public_directory
-- ============================================
CREATE POLICY "public_directory_select_policy" ON public_directory
    FOR SELECT
    USING (
        -- Users can view directory entries in their organization
        organization_id::text IN (
            SELECT jsonb_object_keys((auth.jwt() -> 'app_metadata') -> 'org_roles')
        )
    );

-- ============================================
-- RLS POLICIES: identity_mapping
-- ============================================
CREATE POLICY "identity_mapping_select_own" ON identity_mapping
    FOR SELECT
    USING (
        email_hash = ((auth.jwt() -> 'app_metadata') ->> 'email_hash')
    );

-- ============================================
-- RLS POLICIES: enquiry_messages
-- ============================================
CREATE POLICY "enquiry_messages_select_policy" ON enquiry_messages
    FOR SELECT
    USING (
        -- Can view messages if user can view the associated report
        EXISTS (
            SELECT 1 FROM reports r
            WHERE r.id = enquiry_messages.report_id
            AND (
                r.victim_uin = (
                    SELECT uin FROM identity_mapping 
                    WHERE email_hash = ((auth.jwt() -> 'app_metadata') ->> 'email_hash')
                    LIMIT 1
                )
                OR
                ((auth.jwt() -> 'app_metadata') -> 'org_roles') ->> (r.organization_id::text) = 'Reviewer'
            )
        )
    );

CREATE POLICY "enquiry_messages_insert_policy" ON enquiry_messages
    FOR INSERT
    WITH CHECK (
        -- Can insert messages if user can view the associated report
        EXISTS (
            SELECT 1 FROM reports r
            WHERE r.id = enquiry_messages.report_id
            AND (
                r.victim_uin = (
                    SELECT uin FROM identity_mapping 
                    WHERE email_hash = ((auth.jwt() -> 'app_metadata') ->> 'email_hash')
                    LIMIT 1
                )
                OR
                ((auth.jwt() -> 'app_metadata') -> 'org_roles') ->> (r.organization_id::text) = 'Reviewer'
            )
        )
    );

-- ============================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to public_directory
CREATE TRIGGER update_public_directory_updated_at
    BEFORE UPDATE ON public_directory
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
