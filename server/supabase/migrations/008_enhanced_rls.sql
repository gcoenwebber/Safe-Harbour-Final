-- Migration: Enhanced RLS Policies
-- Description: Strengthen organization isolation and case_token protection

-- ============================================
-- DROP EXISTING POLICIES
-- ============================================
DROP POLICY IF EXISTS "reports_select_policy" ON reports;
DROP POLICY IF EXISTS "reports_insert_policy" ON reports;
DROP POLICY IF EXISTS "reports_update_policy" ON reports;

-- ============================================
-- ENHANCED RLS POLICIES: reports
-- ============================================

-- Policy: Users can SELECT reports where:
-- 1. Report belongs to their organization (mandatory), AND
-- 2. Either their UIN matches victim_uin OR they have IC/Reviewer role
CREATE POLICY "reports_select_policy_v2" ON reports
    FOR SELECT
    USING (
        -- MANDATORY: Organization isolation
        organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::UUID
        AND
        (
            -- Condition 1: User's UIN matches victim_uin
            victim_uin = (auth.jwt() -> 'app_metadata' ->> 'uin')
            OR
            -- Condition 2: User has IC role (presiding_officer or member)
            (auth.jwt() -> 'app_metadata' ->> 'ic_role') IS NOT NULL
            OR
            -- Condition 3: User has Reviewer role
            (auth.jwt() -> 'app_metadata' ->> 'role') = 'Reviewer'
            OR
            (auth.jwt() -> 'app_metadata' ->> 'role') = 'Admin'
        )
    );

-- Policy: Allow authenticated users to insert reports (as victims)
CREATE POLICY "reports_insert_policy_v2" ON reports
    FOR INSERT
    WITH CHECK (
        -- Must belong to user's organization
        organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::UUID
        AND
        -- Victim UIN must match user's UIN
        victim_uin = (auth.jwt() -> 'app_metadata' ->> 'uin')
    );

-- Policy: Allow IC members to update reports for their organization
CREATE POLICY "reports_update_policy_v2" ON reports
    FOR UPDATE
    USING (
        organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::UUID
        AND
        (
            (auth.jwt() -> 'app_metadata' ->> 'ic_role') IS NOT NULL
            OR
            (auth.jwt() -> 'app_metadata' ->> 'role') = 'Admin'
        )
    );

-- ============================================
-- CASE TOKEN PROTECTION
-- ============================================
-- Create function to verify case_token with org check
CREATE OR REPLACE FUNCTION verify_case_token_org(p_case_token TEXT, p_org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM reports 
        WHERE case_token = p_case_token 
        AND organization_id = p_org_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- ENHANCED ENQUIRY MESSAGES POLICIES
-- ============================================
DROP POLICY IF EXISTS "enquiry_messages_select_policy" ON enquiry_messages;
DROP POLICY IF EXISTS "enquiry_messages_insert_policy" ON enquiry_messages;

CREATE POLICY "enquiry_messages_select_policy_v2" ON enquiry_messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM reports r
            WHERE r.id = enquiry_messages.report_id
            AND r.organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::UUID
            AND (
                r.victim_uin = (auth.jwt() -> 'app_metadata' ->> 'uin')
                OR (auth.jwt() -> 'app_metadata' ->> 'ic_role') IS NOT NULL
            )
        )
    );

CREATE POLICY "enquiry_messages_insert_policy_v2" ON enquiry_messages
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM reports r
            WHERE r.id = enquiry_messages.report_id
            AND r.organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::UUID
            AND (
                r.victim_uin = (auth.jwt() -> 'app_metadata' ->> 'uin')
                OR (auth.jwt() -> 'app_metadata' ->> 'ic_role') IS NOT NULL
            )
        )
    );
