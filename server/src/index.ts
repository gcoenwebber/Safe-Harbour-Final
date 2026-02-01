import express, { Request, Response } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { getRedisConnection } from './queues/redisConnection';
import { supabase } from './config/supabase';
import { signup, lookupByEmail } from './controllers/authController';
import { searchDirectory } from './controllers/directoryController';
import { submitReport, getReportStatus } from './controllers/reportController';
import { anonymizeReportContent } from './middleware/anonymizeReport';
import {
    getICReports,
    getPendingApprovals,
    initiateAction,
    castApprovalVote,
    getAuditLogs
} from './controllers/icController';
import {
    extendTimeline,
    getAlerts,
    acknowledgeAlert
} from './controllers/timelineController';
import {
    createOrganization,
    generateInvite,
    validateInviteCode,
    getOrganizationInvites
} from './controllers/organizationController';
import {
    initiateRevealRequest,
    approveRevealRequest,
    executeReveal,
    getRevealRequests
} from './controllers/revealController';
import { handleAuthWebhook } from './controllers/authWebhook';
import { initializeSocketServer } from './socket/chatHandler';
import { startTimelineWorker } from './workers/timelineWorker';

// Load environment variables
dotenv.config();

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3001;

// Initialize Socket.io
initializeSocketServer(httpServer);

// Start BullMQ Timeline Worker (for POSH alerts)
try {
    startTimelineWorker();
} catch (err) {
    console.warn('⚠️ Timeline worker not started (Redis may not be available):', (err as Error).message);
}

// Middleware
app.use(cors());
app.use(express.json());

// Health check route (simple)
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// Deep health check route (for UptimeRobot - pings Redis + Supabase)
app.get('/healthz', async (req: Request, res: Response) => {
    const checks: Record<string, boolean> = {};
    let healthy = true;

    // Check Redis
    try {
        const redis = getRedisConnection();
        if (redis) {
            const pong = await redis.ping();
            checks.redis = pong === 'PONG';
        } else {
            checks.redis = true; // Skip check if Redis not configured
        }
    } catch {
        checks.redis = false;
        healthy = false;
    }

    // Check Supabase
    try {
        if (supabase) {
            const { error } = await supabase
                .from('public_directory')
                .select('uin')
                .limit(1);
            checks.supabase = !error;
        } else {
            checks.supabase = false;
            healthy = false;
        }
    } catch {
        checks.supabase = false;
        healthy = false;
    }

    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'degraded',
        checks,
        timestamp: new Date().toISOString()
    });
});

// Auth routes
app.post('/signup', signup);
app.post('/lookup', lookupByEmail);
app.post('/api/auth/webhook', handleAuthWebhook);

// Organization routes
app.post('/api/organizations', createOrganization);
app.post('/api/organizations/:orgId/invite', generateInvite);
app.get('/api/organizations/:orgId/invites', getOrganizationInvites);
app.get('/api/organizations/join/:code', validateInviteCode);

// Directory routes (for @mentions)
app.get('/api/directory/search', searchDirectory);

// Report routes (with anonymization middleware)
app.post('/api/reports', anonymizeReportContent, submitReport);
app.get('/api/reports/:caseToken', getReportStatus);

// IC Dashboard routes
app.get('/api/ic/reports', getICReports);
app.get('/api/ic/actions/:reportId', getPendingApprovals);
app.post('/api/ic/actions', initiateAction);
app.post('/api/ic/approve', castApprovalVote);
app.get('/api/ic/audit-logs', getAuditLogs);

// Timeline & Alert routes
app.post('/api/ic/extend-timeline', extendTimeline);
app.get('/api/ic/alerts', getAlerts);
app.post('/api/ic/alerts/:alertId/acknowledge', acknowledgeAlert);

// Break-Glass Reveal routes (high-security, multi-signature)
app.post('/api/ic/reveal-request', initiateRevealRequest);
app.post('/api/ic/reveal-approve', approveRevealRequest);
app.get('/api/ic/reveal/:requestId', executeReveal);
app.get('/api/ic/reveal-requests/:reportId', getRevealRequests);

// Start server with Socket.io
httpServer.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log(`📍 Health check available at http://localhost:${PORT}/health`);
    console.log(`📝 Signup available at POST http://localhost:${PORT}/signup`);
    console.log(`🏢 Create org at POST http://localhost:${PORT}/api/organizations`);
    console.log(`📋 Submit report at POST http://localhost:${PORT}/api/reports`);
    console.log(`👥 IC Dashboard at GET http://localhost:${PORT}/api/ic/reports`);
    console.log(`💬 Socket.io chat available at ws://localhost:${PORT}`);
    console.log(`🔐 Auth webhook at POST http://localhost:${PORT}/api/auth/webhook`);
    console.log(`🔓 Break-glass reveal at POST http://localhost:${PORT}/api/ic/reveal-request`);
});

export default app;




