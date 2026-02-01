-- Migration: IC Dashboard Schema
-- Description: Tables for Internal Committee dashboard, quorum-based approvals, and audit logging

-- IC member roles
DO $$ BEGIN
    CREATE TYPE ic_role AS ENUM ('presiding_officer', 'member');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- IC action types
DO $$ BEGIN
    CREATE TYPE ic_action_type AS ENUM (
        'close_case',
        'reveal_identity',
        'grant_paid_leave',
        'recommend_transfer',
        'restructure_reporting'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add ic_role to public_directory
ALTER TABLE public_directory ADD COLUMN IF NOT EXISTS ic_role ic_role;

-- Audit logs table (all IC actions are logged here)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
    action_type ic_action_type NOT NULL,
    actor_uin CHAR(10) NOT NULL,
    actor_role ic_role,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast organization lookups
CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_report ON audit_logs(report_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- Action approvals for quorum tracking
CREATE TABLE IF NOT EXISTS action_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    action_type ic_action_type NOT NULL,
    organization_id UUID NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executed')),
    required_approvals INT DEFAULT 3,
    requires_po BOOLEAN DEFAULT true,
    has_po_approval BOOLEAN DEFAULT false,
    initiated_by_uin CHAR(10) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    executed_at TIMESTAMPTZ,
    UNIQUE(report_id, action_type, status) -- Only one pending action per type per report
);

CREATE INDEX IF NOT EXISTS idx_action_approvals_report ON action_approvals(report_id);
CREATE INDEX IF NOT EXISTS idx_action_approvals_status ON action_approvals(status);

-- Individual approval votes
CREATE TABLE IF NOT EXISTS approval_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_id UUID NOT NULL REFERENCES action_approvals(id) ON DELETE CASCADE,
    approver_uin CHAR(10) NOT NULL,
    approver_role ic_role NOT NULL,
    vote VARCHAR(10) DEFAULT 'approve' CHECK (vote IN ('approve', 'reject')),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(approval_id, approver_uin) -- One vote per member per approval
);

CREATE INDEX IF NOT EXISTS idx_approval_votes_approval ON approval_votes(approval_id);

-- Enable RLS on audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_votes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for audit_logs (organization isolation)
CREATE POLICY "audit_logs_org_isolation" ON audit_logs
    FOR ALL
    USING (
        organization_id IN (
            SELECT organization_id FROM public_directory 
            WHERE uin = (auth.jwt() -> 'app_metadata' ->> 'uin')::CHAR(10)
        )
    );

-- RLS Policies for action_approvals
CREATE POLICY "action_approvals_org_isolation" ON action_approvals
    FOR ALL
    USING (
        organization_id IN (
            SELECT organization_id FROM public_directory 
            WHERE uin = (auth.jwt() -> 'app_metadata' ->> 'uin')::CHAR(10)
        )
    );

-- RLS Policies for approval_votes
CREATE POLICY "approval_votes_access" ON approval_votes
    FOR ALL
    USING (
        approval_id IN (
            SELECT id FROM action_approvals 
            WHERE organization_id IN (
                SELECT organization_id FROM public_directory 
                WHERE uin = (auth.jwt() -> 'app_metadata' ->> 'uin')::CHAR(10)
            )
        )
    );

-- Function to check if quorum is met
CREATE OR REPLACE FUNCTION check_quorum(p_approval_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_approval action_approvals%ROWTYPE;
    v_vote_count INT;
    v_has_po BOOLEAN;
BEGIN
    SELECT * INTO v_approval FROM action_approvals WHERE id = p_approval_id;
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    -- Count approve votes
    SELECT COUNT(*) INTO v_vote_count 
    FROM approval_votes 
    WHERE approval_id = p_approval_id AND vote = 'approve';
    
    -- Check if any PO has approved
    SELECT EXISTS(
        SELECT 1 FROM approval_votes 
        WHERE approval_id = p_approval_id 
        AND vote = 'approve' 
        AND approver_role = 'presiding_officer'
    ) INTO v_has_po;
    
    -- Check quorum: 3+ approvals AND (PO approval if required)
    RETURN v_vote_count >= v_approval.required_approvals 
           AND (NOT v_approval.requires_po OR v_has_po);
END;
$$ LANGUAGE plpgsql;
