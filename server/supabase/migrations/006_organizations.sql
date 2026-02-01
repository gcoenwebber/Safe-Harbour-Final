-- Migration: Organizations and Invite Codes
-- Description: Tables for organization management and employee invitations

-- ============================================
-- TABLE: organizations
-- ============================================
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    domain TEXT, -- e.g., 'acme.com' for email domain validation
    created_by_uin CHAR(10),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizations_name ON organizations(name);

-- ============================================
-- TABLE: invite_codes
-- ============================================
CREATE TABLE IF NOT EXISTS invite_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(8) UNIQUE NOT NULL,
    role VARCHAR(30) DEFAULT 'Employee',
    ic_role VARCHAR(30), -- 'presiding_officer' or 'member' for IC members
    uses_remaining INT DEFAULT -1, -- -1 = unlimited
    uses_count INT DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_by_uin CHAR(10),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_invite_codes_org ON invite_codes(organization_id);

-- ============================================
-- Handle existing organization_id references in public_directory
-- Insert placeholder organizations for any existing organization_ids
-- ============================================
INSERT INTO organizations (id, name, created_at)
SELECT DISTINCT pd.organization_id, 'Legacy Organization ' || ROW_NUMBER() OVER (), now()
FROM public_directory pd
WHERE pd.organization_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = pd.organization_id)
ON CONFLICT (id) DO NOTHING;

-- Also handle identity_mapping table if it has organization_id
INSERT INTO organizations (id, name, created_at)
SELECT DISTINCT im.organization_id, 'Legacy Org (from mapping)', now()
FROM identity_mapping im
WHERE im.organization_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = im.organization_id)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Add organization_id FK to public_directory if not exists
-- ============================================
DO $$ BEGIN
    ALTER TABLE public_directory 
    ADD CONSTRAINT fk_public_directory_organization 
    FOREIGN KEY (organization_id) REFERENCES organizations(id);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- Add ic_role column to public_directory if not exists
-- ============================================
ALTER TABLE public_directory ADD COLUMN IF NOT EXISTS ic_role VARCHAR(30);

-- ============================================
-- ENABLE RLS
-- ============================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;

-- Service role access
CREATE POLICY "service_organizations_full_access" ON organizations
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "service_invite_codes_full_access" ON invite_codes
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Users can view their own organization
CREATE POLICY "org_members_select" ON organizations
    FOR SELECT TO authenticated
    USING (
        id IN (
            SELECT organization_id FROM public_directory 
            WHERE uin = (
                SELECT uin FROM identity_mapping 
                WHERE email_hash = ((auth.jwt() -> 'app_metadata') ->> 'email_hash')
            )
        )
    );

-- Admins can view invite codes for their org
CREATE POLICY "admins_view_invite_codes" ON invite_codes
    FOR SELECT TO authenticated
    USING (
        organization_id IN (
            SELECT organization_id FROM public_directory 
            WHERE uin = (
                SELECT uin FROM identity_mapping 
                WHERE email_hash = ((auth.jwt() -> 'app_metadata') ->> 'email_hash')
            )
            AND role = 'Admin'
        )
    );

-- Updated_at trigger for organizations
CREATE TRIGGER update_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
