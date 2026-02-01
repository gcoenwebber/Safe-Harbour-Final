import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

// Actions that require quorum approval
const QUORUM_ACTIONS = ['close_case', 'reveal_identity'];
const REQUIRED_APPROVALS = 3;

interface ICMember {
    uin: string;
    full_name: string;
    ic_role: 'presiding_officer' | 'member';
}

interface ActionRequest {
    report_id: string;
    action_type: string;
    actor_uin: string;
    details?: Record<string, unknown>;
}

/**
 * Get all reports for IC review
 * GET /api/ic/reports
 */
export async function getICReports(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const { organization_id } = req.query;

        if (!organization_id) {
            res.status(400).json({ error: 'organization_id is required' });
            return;
        }

        const { data: reports, error } = await supabase
            .from('reports')
            .select(`
                id,
                case_token,
                victim_uin,
                subject_uin,
                content,
                incident_type,
                interim_relief,
                status,
                created_at,
                closed_at,
                deadline_at,
                extension_count
            `)
            .eq('organization_id', organization_id)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching IC reports:', error);
            res.status(500).json({ error: 'Failed to fetch reports' });
            return;
        }

        res.status(200).json(reports || []);
    } catch (error) {
        console.error('IC reports error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Get pending approvals for a report
 * GET /api/ic/actions/:reportId
 */
export async function getPendingApprovals(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const { reportId } = req.params;

        const { data: approvals, error } = await supabase
            .from('action_approvals')
            .select(`
                id,
                action_type,
                status,
                required_approvals,
                requires_po,
                has_po_approval,
                initiated_by_uin,
                created_at,
                approval_votes (
                    approver_uin,
                    approver_role,
                    vote,
                    created_at
                )
            `)
            .eq('report_id', reportId)
            .eq('status', 'pending');

        if (error) {
            console.error('Error fetching approvals:', error);
            res.status(500).json({ error: 'Failed to fetch approvals' });
            return;
        }

        res.status(200).json(approvals || []);
    } catch (error) {
        console.error('Pending approvals error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Initiate an IC action
 * POST /api/ic/actions
 */
export async function initiateAction(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const { report_id, action_type, actor_uin, details }: ActionRequest = req.body;

        // Validate required fields
        if (!report_id || !action_type || !actor_uin) {
            res.status(400).json({
                error: 'Missing required fields',
                required: ['report_id', 'action_type', 'actor_uin']
            });
            return;
        }

        // Verify actor is an IC member and get their role
        const { data: actor, error: actorError } = await supabase
            .from('public_directory')
            .select('uin, full_name, ic_role, organization_id')
            .eq('uin', actor_uin)
            .single();

        if (actorError || !actor || !actor.ic_role) {
            res.status(403).json({ error: 'Only IC members can perform this action' });
            return;
        }

        const requiresQuorum = QUORUM_ACTIONS.includes(action_type);

        if (requiresQuorum) {
            // Create approval request for quorum actions
            const { data: approval, error: approvalError } = await supabase
                .from('action_approvals')
                .insert({
                    report_id,
                    action_type,
                    organization_id: actor.organization_id,
                    status: 'pending',
                    required_approvals: REQUIRED_APPROVALS,
                    requires_po: true,
                    initiated_by_uin: actor_uin
                })
                .select()
                .single();

            if (approvalError) {
                // Check if there's already a pending action
                if (approvalError.code === '23505') {
                    res.status(409).json({
                        error: 'An approval request for this action is already pending'
                    });
                    return;
                }
                console.error('Error creating approval:', approvalError);
                res.status(500).json({ error: 'Failed to create approval request' });
                return;
            }

            // Auto-add initiator's vote
            await supabase.from('approval_votes').insert({
                approval_id: approval.id,
                approver_uin: actor_uin,
                approver_role: actor.ic_role,
                vote: 'approve'
            });

            // Update has_po_approval if initiator is PO
            if (actor.ic_role === 'presiding_officer') {
                await supabase
                    .from('action_approvals')
                    .update({ has_po_approval: true })
                    .eq('id', approval.id);
            }

            // Log the initiation
            await logAuditAction(
                actor.organization_id,
                report_id,
                action_type,
                actor_uin,
                actor.ic_role,
                { ...details, status: 'initiated', approval_id: approval.id }
            );

            res.status(201).json({
                message: 'Approval request created',
                approval_id: approval.id,
                requires_quorum: true,
                current_approvals: 1,
                required_approvals: REQUIRED_APPROVALS,
                has_po_approval: actor.ic_role === 'presiding_officer'
            });
        } else {
            // Execute immediately for non-quorum actions
            await executeAction(report_id, action_type, details);

            // Log the action
            await logAuditAction(
                actor.organization_id,
                report_id,
                action_type,
                actor_uin,
                actor.ic_role,
                { ...details, status: 'executed' }
            );

            res.status(200).json({
                message: 'Action executed successfully',
                action_type,
                requires_quorum: false
            });
        }
    } catch (error) {
        console.error('Initiate action error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Cast approval vote
 * POST /api/ic/approve
 */
export async function castApprovalVote(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const { approval_id, approver_uin, vote } = req.body;

        if (!approval_id || !approver_uin) {
            res.status(400).json({
                error: 'Missing required fields',
                required: ['approval_id', 'approver_uin']
            });
            return;
        }

        // Verify approver is an IC member
        const { data: approver, error: approverError } = await supabase
            .from('public_directory')
            .select('uin, ic_role, organization_id')
            .eq('uin', approver_uin)
            .single();

        if (approverError || !approver || !approver.ic_role) {
            res.status(403).json({ error: 'Only IC members can approve actions' });
            return;
        }

        // Get the approval request
        const { data: approval, error: approvalError } = await supabase
            .from('action_approvals')
            .select('*')
            .eq('id', approval_id)
            .eq('status', 'pending')
            .single();

        if (approvalError || !approval) {
            res.status(404).json({ error: 'Approval request not found or already processed' });
            return;
        }

        // Cast the vote
        const { error: voteError } = await supabase.from('approval_votes').insert({
            approval_id,
            approver_uin,
            approver_role: approver.ic_role,
            vote: vote || 'approve'
        });

        if (voteError) {
            if (voteError.code === '23505') {
                res.status(409).json({ error: 'You have already voted on this action' });
                return;
            }
            console.error('Error casting vote:', voteError);
            res.status(500).json({ error: 'Failed to cast vote' });
            return;
        }

        // Update has_po_approval if voter is PO
        if (approver.ic_role === 'presiding_officer' && vote !== 'reject') {
            await supabase
                .from('action_approvals')
                .update({ has_po_approval: true })
                .eq('id', approval_id);
        }

        // Check if quorum is now met
        const quorumResult = await checkQuorum(approval_id);

        if (quorumResult.met) {
            // Execute the action
            await executeAction(approval.report_id, approval.action_type, {});

            // Update approval status
            await supabase
                .from('action_approvals')
                .update({ status: 'executed', executed_at: new Date().toISOString() })
                .eq('id', approval_id);

            // Log execution
            await logAuditAction(
                approval.organization_id,
                approval.report_id,
                approval.action_type,
                approver_uin,
                approver.ic_role,
                { status: 'executed', quorum_met: true, approvers: quorumResult.approvers }
            );

            res.status(200).json({
                message: 'Quorum met! Action executed.',
                quorum_met: true,
                total_approvals: quorumResult.count,
                has_po_approval: quorumResult.hasPO
            });
        } else {
            res.status(200).json({
                message: 'Vote recorded',
                quorum_met: false,
                current_approvals: quorumResult.count,
                required_approvals: REQUIRED_APPROVALS,
                has_po_approval: quorumResult.hasPO,
                needs_po: !quorumResult.hasPO
            });
        }
    } catch (error) {
        console.error('Approval vote error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Check if quorum is met for an approval
 */
async function checkQuorum(approvalId: string): Promise<{
    met: boolean;
    count: number;
    hasPO: boolean;
    approvers: string[];
}> {
    if (!supabase) {
        return { met: false, count: 0, hasPO: false, approvers: [] };
    }

    const { data: votes } = await supabase
        .from('approval_votes')
        .select('approver_uin, approver_role, vote')
        .eq('approval_id', approvalId)
        .eq('vote', 'approve');

    const approveVotes = votes || [];
    const count = approveVotes.length;
    const hasPO = approveVotes.some(v => v.approver_role === 'presiding_officer');
    const approvers = approveVotes.map(v => v.approver_uin);

    return {
        met: count >= REQUIRED_APPROVALS && hasPO,
        count,
        hasPO,
        approvers
    };
}

/**
 * Execute an IC action
 */
async function executeAction(
    reportId: string,
    actionType: string,
    _details: Record<string, unknown> | undefined
): Promise<void> {
    if (!supabase) return;

    switch (actionType) {
        case 'close_case':
            await supabase
                .from('reports')
                .update({ status: 'resolved', closed_at: new Date().toISOString() })
                .eq('id', reportId);
            break;

        case 'grant_paid_leave':
        case 'recommend_transfer':
        case 'restructure_reporting':
            // Update interim_relief on the report
            const { data: report } = await supabase
                .from('reports')
                .select('interim_relief')
                .eq('id', reportId)
                .single();

            const currentRelief = report?.interim_relief || [];
            if (!currentRelief.includes(actionType)) {
                await supabase
                    .from('reports')
                    .update({ interim_relief: [...currentRelief, actionType] })
                    .eq('id', reportId);
            }
            break;

        case 'reveal_identity':
            // This would typically unlock identity data - implementation depends on business logic
            // For now, just log it
            break;
    }
}

/**
 * Log an action to audit_logs
 */
async function logAuditAction(
    organizationId: string,
    reportId: string,
    actionType: string,
    actorUin: string,
    actorRole: string,
    details: Record<string, unknown>
): Promise<void> {
    if (!supabase) return;

    await supabase.from('audit_logs').insert({
        organization_id: organizationId,
        report_id: reportId,
        action_type: actionType,
        actor_uin: actorUin,
        actor_role: actorRole,
        details
    });
}

/**
 * Get audit logs for an organization
 * GET /api/ic/audit-logs
 */
export async function getAuditLogs(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const { organization_id, report_id, limit = 50 } = req.query;

        if (!organization_id) {
            res.status(400).json({ error: 'organization_id is required' });
            return;
        }

        let query = supabase
            .from('audit_logs')
            .select('*')
            .eq('organization_id', organization_id)
            .order('created_at', { ascending: false })
            .limit(Number(limit));

        if (report_id) {
            query = query.eq('report_id', report_id);
        }

        const { data: logs, error } = await query;

        if (error) {
            console.error('Error fetching audit logs:', error);
            res.status(500).json({ error: 'Failed to fetch audit logs' });
            return;
        }

        res.status(200).json(logs || []);
    } catch (error) {
        console.error('Audit logs error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
