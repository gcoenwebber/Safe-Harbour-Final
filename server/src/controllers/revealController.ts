import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

/**
 * Break-Glass Respondent Reveal Controller
 * Requires multi-signature approval (2 IC members) for legal action
 */

interface RevealRequest {
    report_id: string;
    reason: string;
}

interface ApprovalVote {
    request_id: string;
}

/**
 * POST /api/ic/reveal-request
 * Initiate a break-glass request to reveal respondent identity
 */
export async function initiateRevealRequest(req: Request, res: Response): Promise<void> {
    try {
        const { report_id, reason } = req.body as RevealRequest;
        const requesterUin = req.headers['x-user-uin'] as string;
        const requesterIcRole = req.headers['x-user-ic-role'] as string;
        const organizationId = req.headers['x-organization-id'] as string;

        if (!requesterIcRole) {
            res.status(403).json({ error: 'Only IC members can initiate reveal requests' });
            return;
        }

        if (!report_id || !reason) {
            res.status(400).json({ error: 'report_id and reason are required' });
            return;
        }

        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        // Verify report exists and belongs to organization
        const { data: report, error: reportError } = await supabase
            .from('reports')
            .select('id, organization_id, subject_uin')
            .eq('id', report_id)
            .eq('organization_id', organizationId)
            .single();

        if (reportError || !report) {
            res.status(404).json({ error: 'Report not found' });
            return;
        }

        // Check for existing pending request
        const { data: existing } = await supabase
            .from('reveal_requests')
            .select('id')
            .eq('report_id', report_id)
            .eq('status', 'pending')
            .single();

        if (existing) {
            res.status(400).json({ error: 'A pending reveal request already exists for this report' });
            return;
        }

        // Create reveal request
        const { data: request, error: insertError } = await supabase
            .from('reveal_requests')
            .insert({
                report_id,
                organization_id: organizationId,
                requested_by_uin: requesterUin,
                reason,
                required_approvals: 2,
                status: 'pending'
            })
            .select()
            .single();

        if (insertError) {
            res.status(500).json({ error: 'Failed to create reveal request' });
            return;
        }

        // Log to audit
        await supabase.from('audit_logs').insert({
            organization_id: organizationId,
            report_id,
            action_type: 'reveal_identity',
            actor_uin: requesterUin,
            details: {
                action: 'break_glass_initiated',
                request_id: request.id,
                reason
            }
        });

        res.status(201).json({
            message: 'Break-glass reveal request initiated',
            request_id: request.id,
            required_approvals: 2,
            current_approvals: 0
        });

    } catch (error) {
        console.error('Reveal request error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * POST /api/ic/reveal-approve
 * Cast approval vote for a reveal request
 */
export async function approveRevealRequest(req: Request, res: Response): Promise<void> {
    try {
        const { request_id } = req.body as ApprovalVote;
        const approverUin = req.headers['x-user-uin'] as string;
        const approverIcRole = req.headers['x-user-ic-role'] as string;
        const organizationId = req.headers['x-organization-id'] as string;

        if (!approverIcRole) {
            res.status(403).json({ error: 'Only IC members can approve reveal requests' });
            return;
        }

        if (!request_id) {
            res.status(400).json({ error: 'request_id is required' });
            return;
        }

        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        // Verify request exists and is pending
        const { data: request, error: reqError } = await supabase
            .from('reveal_requests')
            .select('*')
            .eq('id', request_id)
            .eq('organization_id', organizationId)
            .eq('status', 'pending')
            .single();

        if (reqError || !request) {
            res.status(404).json({ error: 'Pending reveal request not found' });
            return;
        }

        // Check if already approved by this user
        const { data: existingVote } = await supabase
            .from('reveal_approvals')
            .select('id')
            .eq('request_id', request_id)
            .eq('approver_uin', approverUin)
            .single();

        if (existingVote) {
            res.status(400).json({ error: 'You have already approved this request' });
            return;
        }

        // Prevent self-approval (requester cannot approve their own request)
        if (request.requested_by_uin === approverUin) {
            res.status(400).json({ error: 'You cannot approve your own request' });
            return;
        }

        // Cast approval vote
        const { error: voteError } = await supabase
            .from('reveal_approvals')
            .insert({
                request_id,
                approver_uin: approverUin,
                approver_role: approverIcRole
            });

        if (voteError) {
            res.status(500).json({ error: 'Failed to record approval' });
            return;
        }

        // Count current approvals
        const { count } = await supabase
            .from('reveal_approvals')
            .select('*', { count: 'exact', head: true })
            .eq('request_id', request_id);

        const approvalCount = count || 0;
        const quorumMet = approvalCount >= request.required_approvals;

        // Update request status if quorum met
        if (quorumMet) {
            await supabase
                .from('reveal_requests')
                .update({ status: 'approved' })
                .eq('id', request_id);
        }

        // Log approval
        await supabase.from('audit_logs').insert({
            organization_id: organizationId,
            report_id: request.report_id,
            action_type: 'reveal_identity',
            actor_uin: approverUin,
            details: {
                action: 'break_glass_approved',
                request_id,
                approval_count: approvalCount,
                quorum_met: quorumMet
            }
        });

        res.json({
            message: quorumMet ? 'Quorum met! Reveal is now authorized.' : 'Approval recorded',
            current_approvals: approvalCount,
            required_approvals: request.required_approvals,
            quorum_met: quorumMet
        });

    } catch (error) {
        console.error('Reveal approval error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * GET /api/ic/reveal/:requestId
 * Execute reveal after quorum is met - retrieve respondent email
 */
export async function executeReveal(req: Request, res: Response): Promise<void> {
    try {
        const { requestId } = req.params;
        const executorUin = req.headers['x-user-uin'] as string;
        const executorIcRole = req.headers['x-user-ic-role'] as string;
        const organizationId = req.headers['x-organization-id'] as string;

        if (!executorIcRole) {
            res.status(403).json({ error: 'Only IC members can execute reveal' });
            return;
        }

        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        // Get approved request
        const { data: request, error: reqError } = await supabase
            .from('reveal_requests')
            .select('*, reports(subject_uin)')
            .eq('id', requestId)
            .eq('organization_id', organizationId)
            .eq('status', 'approved')
            .single();

        if (reqError || !request) {
            res.status(404).json({ error: 'Approved reveal request not found. Quorum may not be met.' });
            return;
        }

        // Get respondent email from identity_mapping (the vault)
        const subjectUin = request.reports?.subject_uin;

        // NOTE: In production, this would query a secure vault service
        // For now, we return a masked indicator
        const { data: identityData } = await supabase
            .from('identity_mapping')
            .select('email_hash')
            .eq('uin', subjectUin)
            .single();

        // Update request as executed
        await supabase
            .from('reveal_requests')
            .update({
                status: 'executed',
                executed_at: new Date().toISOString(),
                executed_by_uin: executorUin,
                respondent_email: `[REVEALED - Hash: ${identityData?.email_hash?.substring(0, 16)}...]`
            })
            .eq('id', requestId);

        // Comprehensive audit log
        const approversList = await getApprovers(supabase, String(requestId));
        await supabase.from('audit_logs').insert({
            organization_id: organizationId,
            report_id: request.report_id,
            action_type: 'reveal_identity',
            actor_uin: executorUin,
            details: {
                action: 'break_glass_executed',
                request_id: requestId,
                subject_uin: subjectUin,
                reason: request.reason,
                approvers: approversList
            }
        });

        res.json({
            message: '⚠️ BREAK-GLASS EXECUTED - Identity revealed for legal action',
            subject_uin: subjectUin,
            email_hash: identityData?.email_hash,
            reason: request.reason,
            executed_at: new Date().toISOString(),
            warning: 'This action has been logged and is subject to legal review'
        });

    } catch (error) {
        console.error('Reveal execution error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

async function getApprovers(db: typeof supabase, requestId: string): Promise<string[]> {
    if (!db) return [];
    const { data } = await db
        .from('reveal_approvals')
        .select('approver_uin')
        .eq('request_id', requestId);
    return data?.map(a => a.approver_uin) || [];
}

/**
 * GET /api/ic/reveal-requests/:reportId
 * Get pending reveal requests for a report
 */
export async function getRevealRequests(req: Request, res: Response): Promise<void> {
    try {
        const { reportId } = req.params;
        const organizationId = req.headers['x-organization-id'] as string;

        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const { data: requests, error } = await supabase
            .from('reveal_requests')
            .select(`
                *,
                reveal_approvals(approver_uin, approver_role, approved_at)
            `)
            .eq('report_id', reportId)
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false });

        if (error) {
            res.status(500).json({ error: 'Failed to fetch reveal requests' });
            return;
        }

        res.json({ requests });

    } catch (error) {
        console.error('Get reveal requests error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
