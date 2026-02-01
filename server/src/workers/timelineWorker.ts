import { Worker, Job } from 'bullmq';
import { getRedisConnection } from '../queues/redisConnection';
import { TimelineAlertData, cancelTimelineAlerts } from '../queues/timelineQueue';
import { supabase } from '../config/supabase';

/**
 * Process timeline alert jobs
 */
async function processTimelineAlert(job: Job<TimelineAlertData>): Promise<void> {
    const { reportId, organizationId, alertType, recipientType } = job.data;

    console.log(`\n⏰ Processing ${alertType.toUpperCase()} alert for report ${reportId}`);

    if (!supabase) {
        throw new Error('Database not configured');
    }

    // Check current report status
    const { data: report, error: reportError } = await supabase
        .from('reports')
        .select('status, victim_uin, subject_uin')
        .eq('id', reportId)
        .single();

    if (reportError || !report) {
        console.log(`   ❌ Report not found: ${reportId}`);
        return;
    }

    // For Amber Alert: Only trigger if status is NOT 'investigating'
    if (alertType === 'amber' && report.status === 'investigating') {
        console.log(`   ✅ Report is already under investigation, skipping Amber alert`);
        return;
    }

    // For any alert: Skip if already resolved
    if (report.status === 'resolved') {
        console.log(`   ✅ Report already resolved, cancelling alerts`);
        await cancelTimelineAlerts(reportId);
        return;
    }

    // Find recipient
    let recipientUin: string | null = null;

    if (recipientType === 'ic_lead') {
        // Find IC Lead (Presiding Officer) for the organization
        const { data: icLead } = await supabase
            .from('public_directory')
            .select('uin')
            .eq('organization_id', organizationId)
            .eq('ic_role', 'presiding_officer')
            .single();

        recipientUin = icLead?.uin || null;
    } else if (recipientType === 'ceo') {
        // Find CEO or highest authority for the organization
        const { data: ceo } = await supabase
            .from('public_directory')
            .select('uin')
            .eq('organization_id', organizationId)
            .eq('role', 'CEO')
            .single();

        recipientUin = ceo?.uin || null;
    }

    // Record the alert
    const { error: alertError } = await supabase.from('alerts').insert({
        report_id: reportId,
        organization_id: organizationId,
        alert_type: alertType,
        recipient_type: recipientType,
        recipient_uin: recipientUin,
        scheduled_for: job.data.scheduledFor,
        sent_at: new Date().toISOString()
    });

    if (alertError) {
        console.error(`   ❌ Failed to record alert:`, alertError);
        throw alertError;
    }

    // Log the alert
    const alertEmoji = alertType === 'amber' ? '🟡' : '🔴';
    console.log(`   ${alertEmoji} ${alertType.toUpperCase()} Alert sent!`);
    console.log(`   📧 Recipient: ${recipientType} (${recipientUin || 'not found'})`);
    console.log(`   📋 Report Status: ${report.status}`);

    // In production, this would send an actual notification (email, push, etc.)
    // For now, we just record it in the database

    // TODO: Integrate with notification service
    // await sendNotification({
    //     type: alertType,
    //     recipientUin,
    //     reportId,
    //     message: alertType === 'amber' 
    //         ? 'Report pending for 10+ days - please investigate'
    //         : 'Critical: Report pending for 15+ days - CEO escalation'
    // });
}

/**
 * Create and start the Timeline Worker
 */
export function startTimelineWorker(): Worker | null {
    const connection = getRedisConnection();

    // Skip worker if Redis not available
    if (!connection) {
        console.log('⚠️ Timeline worker not started (Redis not configured)');
        return null;
    }

    const worker = new Worker<TimelineAlertData>(
        'timeline-alerts',
        processTimelineAlert,
        {
            connection,
            concurrency: 5
        }
    );

    worker.on('completed', (job) => {
        console.log(`✅ Job ${job.id} completed`);
    });

    worker.on('failed', (job, err) => {
        console.error(`❌ Job ${job?.id} failed:`, err.message);
    });

    worker.on('error', (err) => {
        console.error('Worker error:', err);
    });

    console.log('👷 Timeline worker started');
    return worker;
}

export default startTimelineWorker;
