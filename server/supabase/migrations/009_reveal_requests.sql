-- Migration: Break-Glass Reveal Requests
-- Description: Multi-signature approval system for revealing respondent identity

-- ============================================
-- TABLE: reveal_requests
-- ============================================
CREATE TABLE IF NOT EXISTS reveal_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL,
    requested_by_uin VARCHAR(20) NOT NULL,
    reason TEXT NOT NULL,
    required_approvals INT DEFAULT 2,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executed')),
    respondent_email TEXT, -- Only populated after execution
    created_at TIMESTAMPTZ DEFAULT now(),
    executed_at TIMESTAMPTZ,
    executed_by_uin VARCHAR(20),
    UNIQUE(report_id, status) -- Only one pending/approved request per report
);

CREATE INDEX IF NOT EXISTS idx_reveal_requests_report ON reveal_requests(report_id);
CREATE INDEX IF NOT EXISTS idx_reveal_requests_org ON reveal_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_reveal_requests_status ON reveal_requests(status);

-- ============================================
-- TABLE: reveal_approvals
-- ============================================
CREATE TABLE IF NOT EXISTS reveal_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES reveal_requests(id) ON DELETE CASCADE,
    approver_uin VARCHAR(20) NOT NULL,
    approver_role VARCHAR(50) NOT NULL,
    approved_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(request_id, approver_uin) -- One approval per IC member per request
);

CREATE INDEX IF NOT EXISTS idx_reveal_approvals_request ON reveal_approvals(request_id);

-- ============================================
-- ENABLE RLS
-- ============================================
ALTER TABLE reveal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE reveal_approvals ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES
-- ============================================
CREATE POLICY "reveal_requests_org_isolation" ON reveal_requests
    FOR ALL
    USING (
        organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::UUID
        AND (auth.jwt() -> 'app_metadata' ->> 'ic_role') IS NOT NULL
    );

CREATE POLICY "reveal_approvals_ic_only" ON reveal_approvals
    FOR ALL
    USING (
        request_id IN (
            SELECT id FROM reveal_requests 
            WHERE organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::UUID
        )
        AND (auth.jwt() -> 'app_metadata' ->> 'ic_role') IS NOT NULL
    );

-- ============================================
-- AUDIT LOG FOR REVEAL ACTIONS
-- ============================================
-- Add reveal action type if not exists
DO $$ BEGIN
    ALTER TYPE ic_action_type ADD VALUE IF NOT EXISTS 'break_glass_reveal';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================
-- FUNCTION: Check reveal quorum (2 IC members)
-- ============================================
CREATE OR REPLACE FUNCTION check_reveal_quorum(p_request_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_request reveal_requests%ROWTYPE;
    v_approval_count INT;
BEGIN
    SELECT * INTO v_request FROM reveal_requests WHERE id = p_request_id;
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    -- Count approvals
    SELECT COUNT(*) INTO v_approval_count
    FROM reveal_approvals
    WHERE request_id = p_request_id;
    
    -- Quorum met: 2+ IC member approvals
    RETURN v_approval_count >= v_request.required_approvals;
END;
$$ LANGUAGE plpgsql;
