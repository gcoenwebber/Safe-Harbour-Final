import { Queue, JobsOptions } from 'bullmq';
import { getRedisConnection } from './redisConnection';

// POSH Timeline Constants
export const AMBER_ALERT_DAYS = 10;
export const RED_ALERT_DAYS = 15;
export const MAX_DEADLINE_DAYS = 90;

// Convert days to milliseconds
const daysToMs = (days: number) => days * 24 * 60 * 60 * 1000;

// For development/testing: use shorter intervals (minutes instead of days)
const DEV_MODE = process.env.NODE_ENV === 'development';
const devDaysToMs = (days: number) => DEV_MODE ? days * 60 * 1000 : daysToMs(days); // 1 day = 1 minute in dev

export interface TimelineAlertData {
    reportId: string;
    organizationId: string;
    alertType: 'amber' | 'red';
    recipientType: 'ic_lead' | 'ceo';
    scheduledFor: string; // ISO date string
}

/**
 * Create Timeline Queue for POSH alerts
 */
export function createTimelineQueue(): Queue<TimelineAlertData> | null {
    const connection = getRedisConnection();

    // Skip queue creation if Redis not available
    if (!connection) {
        console.log('⚠️ Timeline queue not initialized (Redis not configured)');
        return null;
    }

    const queue = new Queue<TimelineAlertData>('timeline-alerts', {
        connection,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 5000
            },
            removeOnComplete: 100,
            removeOnFail: 500
        }
    });

    console.log('📋 Timeline alert queue initialized');
    return queue;
}

// Singleton queue instance
let _queue: Queue<TimelineAlertData> | null = null;
let _queueChecked = false;

export function getTimelineQueue(): Queue<TimelineAlertData> | null {
    if (!_queueChecked) {
        _queue = createTimelineQueue();
        _queueChecked = true;
    }
    return _queue;
}

/**
 * Schedule timeline alerts for a new report
 */
export async function scheduleTimelineAlerts(
    reportId: string,
    organizationId: string,
    submissionDate: Date = new Date()
): Promise<void> {
    const queue = getTimelineQueue();

    // Skip if Redis not available
    if (!queue) {
        console.log(`⚠️ Skipping alert scheduling for ${reportId} (Redis not configured)`);
        return;
    }

    // Schedule Amber Alert (10 days)
    const amberDate = new Date(submissionDate.getTime() + devDaysToMs(AMBER_ALERT_DAYS));
    await queue.add(
        `amber-${reportId}`,
        {
            reportId,
            organizationId,
            alertType: 'amber',
            recipientType: 'ic_lead',
            scheduledFor: amberDate.toISOString()
        },
        {
            delay: devDaysToMs(AMBER_ALERT_DAYS),
            jobId: `amber-${reportId}`
        }
    );

    // Schedule Red Alert (15 days)
    const redDate = new Date(submissionDate.getTime() + devDaysToMs(RED_ALERT_DAYS));
    await queue.add(
        `red-${reportId}`,
        {
            reportId,
            organizationId,
            alertType: 'red',
            recipientType: 'ceo',
            scheduledFor: redDate.toISOString()
        },
        {
            delay: devDaysToMs(RED_ALERT_DAYS),
            jobId: `red-${reportId}`
        }
    );

    console.log(`⏰ Scheduled alerts for report ${reportId}:`);
    console.log(`   🟡 Amber: ${amberDate.toISOString()}`);
    console.log(`   🔴 Red: ${redDate.toISOString()}`);
}

/**
 * Cancel all scheduled alerts for a report (e.g., when resolved)
 */
export async function cancelTimelineAlerts(reportId: string): Promise<void> {
    const queue = getTimelineQueue();

    // Skip if Redis not available
    if (!queue) {
        return;
    }

    try {
        const amberJob = await queue.getJob(`amber-${reportId}`);
        if (amberJob) await amberJob.remove();

        const redJob = await queue.getJob(`red-${reportId}`);
        if (redJob) await redJob.remove();

        console.log(`🚫 Cancelled alerts for report ${reportId}`);
    } catch (error) {
        console.error('Error cancelling alerts:', error);
    }
}

export default getTimelineQueue;
