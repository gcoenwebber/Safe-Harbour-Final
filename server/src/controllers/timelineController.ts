import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { MAX_DEADLINE_DAYS } from '../queues/timelineQueue';

interface ExtendTimelineRequest {
    report_id: string;
    actor_uin: string;
    reason: string;
    extend_days?: number;
}

/**
 * Extend timeline for a report (IC-only)
 * POST /api/ic/extend-timeline
 */
export async function extendTimeline(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const { report_id, actor_uin, reason, extend_days = 30 }: ExtendTimelineRequest = req.body;

        // Validate required fields
        if (!report_id || !actor_uin || !reason) {
            res.status(400).json({
                error: 'Missing required fields',
                required: ['report_id', 'actor_uin', 'reason']
            });
            return;
        }

        // Reason must be meaningful (at least 20 characters)
        if (reason.trim().length < 20) {
            res.status(400).json({
                error: 'Reason for delay must be at least 20 characters'
            });
            return;
        }

        // Verify actor is an IC member
        const { data: actor, error: actorError } = await supabase
            .from('public_directory')
            .select('uin, full_name, ic_role, organization_id')
            .eq('uin', actor_uin)
            .single();

        if (actorError || !actor || !actor.ic_role) {
            res.status(403).json({ error: 'Only IC members can extend timelines' });
            return;
        }

        // Get current report details
        const { data: report, error: reportError } = await supabase
            .from('reports')
            .select('id, created_at, deadline_at, extension_count, status')
            .eq('id', report_id)
            .single();

        if (reportError || !report) {
            res.status(404).json({ error: 'Report not found' });
            return;
        }

        // Cannot extend resolved reports
        if (report.status === 'resolved') {
            res.status(400).json({ error: 'Cannot extend timeline for resolved reports' });
            return;
        }

        // Calculate new deadline
        const createdAt = new Date(report.created_at);
        const currentDeadline = new Date(report.deadline_at);
        const newDeadline = new Date(currentDeadline.getTime() + extend_days * 24 * 60 * 60 * 1000);

        // Calculate days from submission
        const maxDeadline = new Date(createdAt.getTime() + MAX_DEADLINE_DAYS * 24 * 60 * 60 * 1000);

        // Enforce 90-day POSH legal limit
        if (newDeadline > maxDeadline) {
            const remainingDays = Math.floor((maxDeadline.getTime() - currentDeadline.getTime()) / (24 * 60 * 60 * 1000));
            res.status(400).json({
                error: 'Cannot extend beyond 90-day POSH legal limit',
                max_deadline: maxDeadline.toISOString(),
                remaining_extension_days: Math.max(0, remainingDays)
            });
            return;
        }

        // Update report with new deadline
        const { error: updateError } = await supabase
            .from('reports')
            .update({
                deadline_at: newDeadline.toISOString(),
                extended_by_uin: actor_uin,
                extension_reason: reason,
                extension_count: (report.extension_count || 0) + 1
            })
            .eq('id', report_id);

        if (updateError) {
            console.error('Error extending timeline:', updateError);
            res.status(500).json({ error: 'Failed to extend timeline' });
            return;
        }

        // Log to audit trail
        await supabase.from('audit_logs').insert({
            organization_id: actor.organization_id,
            report_id,
            action_type: 'extend_timeline',
            actor_uin,
            actor_role: actor.ic_role,
            details: {
                previous_deadline: report.deadline_at,
                new_deadline: newDeadline.toISOString(),
                extension_days: extend_days,
                reason: reason.trim(),
                extension_count: (report.extension_count || 0) + 1
            }
        });

        console.log(`📅 Timeline extended for report ${report_id}:`);
        console.log(`   Previous: ${report.deadline_at}`);
        console.log(`   New: ${newDeadline.toISOString()}`);
        console.log(`   Reason: ${reason.substring(0, 50)}...`);

        res.status(200).json({
            message: 'Timeline extended successfully',
            previous_deadline: report.deadline_at,
            new_deadline: newDeadline.toISOString(),
            extension_days: extend_days,
            extension_count: (report.extension_count || 0) + 1,
            max_deadline: maxDeadline.toISOString()
        });
    } catch (error) {
        console.error('Extend timeline error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Get alerts for a report or organization
 * GET /api/ic/alerts
 */
export async function getAlerts(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const { organization_id, report_id, unacknowledged_only } = req.query;

        if (!organization_id) {
            res.status(400).json({ error: 'organization_id is required' });
            return;
        }

        let query = supabase
            .from('alerts')
            .select('*')
            .eq('organization_id', organization_id)
            .order('scheduled_for', { ascending: false });

        if (report_id) {
            query = query.eq('report_id', report_id);
        }

        if (unacknowledged_only === 'true') {
            query = query.is('acknowledged_at', null);
        }

        const { data: alerts, error } = await query;

        if (error) {
            console.error('Error fetching alerts:', error);
            res.status(500).json({ error: 'Failed to fetch alerts' });
            return;
        }

        res.status(200).json(alerts || []);
    } catch (error) {
        console.error('Get alerts error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Acknowledge an alert
 * POST /api/ic/alerts/:alertId/acknowledge
 */
export async function acknowledgeAlert(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const { alertId } = req.params;
        const { acknowledger_uin } = req.body;

        if (!acknowledger_uin) {
            res.status(400).json({ error: 'acknowledger_uin is required' });
            return;
        }

        const { error } = await supabase
            .from('alerts')
            .update({
                acknowledged_at: new Date().toISOString(),
                acknowledged_by_uin: acknowledger_uin
            })
            .eq('id', alertId);

        if (error) {
            console.error('Error acknowledging alert:', error);
            res.status(500).json({ error: 'Failed to acknowledge alert' });
            return;
        }

        res.status(200).json({ message: 'Alert acknowledged' });
    } catch (error) {
        console.error('Acknowledge alert error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
