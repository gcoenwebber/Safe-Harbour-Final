-- Migration: POSH Timeline Alerts
-- Description: Adds timeline tracking and alerts for statutory POSH compliance

-- Add timeline columns to reports table
ALTER TABLE reports ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS extended_by_uin CHAR(10);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS extension_reason TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS extension_count INTEGER DEFAULT 0;

-- Create alerts table for tracking notifications
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL,
    alert_type VARCHAR(20) NOT NULL CHECK (alert_type IN ('amber', 'red')),
    recipient_type VARCHAR(20) NOT NULL CHECK (recipient_type IN ('ic_lead', 'ceo')),
    recipient_uin CHAR(10),
    scheduled_for TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by_uin CHAR(10),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_alerts_report ON alerts(report_id);
CREATE INDEX IF NOT EXISTS idx_alerts_organization ON alerts(organization_id);
CREATE INDEX IF NOT EXISTS idx_alerts_scheduled ON alerts(scheduled_for) WHERE sent_at IS NULL;

-- Enable RLS
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

-- Policy for service role (backend uses service key)
CREATE POLICY "service_role_alerts_full_access" ON alerts
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Policy for IC members to view alerts in their organization
CREATE POLICY "ic_view_alerts" ON alerts
    FOR SELECT
    TO authenticated
    USING (
        organization_id IN (
            SELECT organization_id FROM public_directory 
            WHERE uin = (
                SELECT uin FROM identity_mapping 
                WHERE email_hash = ((auth.jwt() -> 'app_metadata') ->> 'email_hash')
            )
            AND ic_role IS NOT NULL
        )
    );

-- Set default deadline when report is created (90 days from submission)
CREATE OR REPLACE FUNCTION set_report_deadline()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.deadline_at IS NULL THEN
        NEW.deadline_at := NEW.created_at + INTERVAL '90 days';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_report_deadline_trigger ON reports;
CREATE TRIGGER set_report_deadline_trigger
    BEFORE INSERT ON reports
    FOR EACH ROW
    EXECUTE FUNCTION set_report_deadline();
