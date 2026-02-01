import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { generateCaseToken, isValidCaseToken } from '../utils/caseToken';
import { hashEmail } from '../utils/identity';
import { scheduleTimelineAlerts } from '../queues/timelineQueue';

/* -------------------------------------------------------------------------- */
/*                                    TYPES                                   */
/* -------------------------------------------------------------------------- */

interface SubmitReportRequest {
    email: string;
    content: string;
    incident_type: 'physical' | 'verbal' | 'psychological';
    interim_relief?: string[];
    organization_id: string;
}

/*                               HELPER FUNCTIONS                              */
/* -------------------------------------------------------------------------- */

interface MentionResult {
    uins: string[];          // From @[Name](UIN) format
    usernames: string[];     // From @username format
}

/**
 * Extract mentions from content - supports both formats:
 * 1. @[DisplayName](UIN) - from autocomplete (preferred)
 * 2. @username - typed manually (fallback)
 */
function extractMentions(content: string): MentionResult {
    // Extract from autocomplete format: @[Name](UIN)
    const uinRegex = /@\[([^\]]+)\]\((\d+)\)/g;
    const uinMatches = [...content.matchAll(uinRegex)];
    const uins = [...new Set(uinMatches.map(m => m[2]))];

    // Extract from manual format: @username (but not from autocomplete format)
    // First, remove autocomplete mentions so we don't double-count
    const contentWithoutAutocomplete = content.replace(/@\[[^\]]+\]\(\d+\)/g, '');
    const usernameRegex = /@([a-zA-Z0-9._-]+)/g;
    const usernameMatches = [...contentWithoutAutocomplete.matchAll(usernameRegex)];
    const usernames = [...new Set(usernameMatches.map(m => m[1].toLowerCase()))];

    return { uins, usernames };
}

/**
 * Replace mentions with SUBJECT_n aliases
 * Supports both @[DisplayName](UIN) and @username formats
 */
function anonymizeContent(
    content: string,
    aliasMap: Map<string, string>  // key can be UIN or username
): string {
    let anonymized = content;

    for (const [key, alias] of aliasMap.entries()) {
        // Try UIN format first: @[Any Display Name](UIN)
        const uinRegex = new RegExp(`@\\[[^\\]]+\\]\\(${key}\\)`, 'g');
        anonymized = anonymized.replace(uinRegex, alias);

        // Then username format: @username
        const usernameRegex = new RegExp(`@${key}\\b`, 'gi');
        anonymized = anonymized.replace(usernameRegex, alias);
    }

    return anonymized;
}

/* -------------------------------------------------------------------------- */
/*                                SUBMIT REPORT                                */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/reports
 */
export async function submitReport(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const {
            email,
            content,
            incident_type,
            interim_relief,
            organization_id
        }: SubmitReportRequest = req.body;

        /* ------------------------------ Validation -------------------------- */

        if (!email || !content || !incident_type || !organization_id) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        if (!['physical', 'verbal', 'psychological'].includes(incident_type)) {
            res.status(400).json({ error: 'Invalid incident type' });
            return;
        }

        /* ------------------------ Resolve victim identity ------------------- */

        const emailHash = hashEmail(email);

        const { data: victimIdentity, error: victimError } = await supabase
            .from('identity_mapping')
            .select('uin')
            .eq('email_hash', emailHash)
            .single();

        if (victimError || !victimIdentity) {
            res.status(404).json({
                error: 'User not found. Please register first.'
            });
            return;
        }

        const victim_uin = victimIdentity.uin;

        /* ----------------------- Extract mentions from content -------------- */

        const mentions = extractMentions(content);

        let subject_uins: string[] = [];
        let finalContent = content;
        const aliasMap = new Map<string, string>();
        let aliasCounter = 1;

        /* -------- Resolve UINs from @[Name](UIN) format --------------------- */

        if (mentions.uins.length > 0) {
            // Verify all mentioned UINs exist in public_directory
            const { data: validUsers, error: uinError } =
                await supabase
                    .from('public_directory')
                    .select('uin')
                    .in('uin', mentions.uins);

            if (uinError || !validUsers) {
                res.status(500).json({
                    error: 'Failed to validate mentioned users'
                });
                return;
            }

            const validUins = validUsers.map((u: { uin: string }) => u.uin);

            // Add valid UINs to subject list
            for (const uin of mentions.uins) {
                if (validUins.includes(uin)) {
                    aliasMap.set(uin, `SUBJECT_${aliasCounter++}`);
                    subject_uins.push(uin);
                }
            }
        }

        /* -------- Resolve usernames from @username format ------------------- */

        if (mentions.usernames.length > 0) {
            // Look up usernames in identity_mapping
            const { data: usersByUsername, error: usernameError } =
                await supabase
                    .from('identity_mapping')
                    .select('username, uin')
                    .in('username', mentions.usernames);

            if (usernameError) {
                console.warn('Username lookup error:', usernameError);
            }

            if (usersByUsername && usersByUsername.length > 0) {
                for (const user of usersByUsername) {
                    aliasMap.set(user.username, `SUBJECT_${aliasCounter++}`);
                    subject_uins.push(user.uin);
                }
            }
        }

        /* -------- Anonymize content ----------------------------------------- */

        if (aliasMap.size > 0) {
            finalContent = anonymizeContent(content, aliasMap);
        }

        /* ------------------------------ Create report ----------------------- */

        const case_token = generateCaseToken();

        const { data: report, error: reportError } = await supabase
            .from('reports')
            .insert({
                victim_uin,
                subject_uins,
                content: finalContent,
                incident_type,
                interim_relief: interim_relief || [],
                organization_id,
                case_token,
                status: 'pending'
            })
            .select('id, case_token, created_at')
            .single();

        if (reportError) {
            console.error('Report submission error:', reportError);
            res.status(500).json({ error: 'Failed to submit report' });
            return;
        }

        /* ------------------------ Schedule timeline alerts ------------------ */

        try {
            await scheduleTimelineAlerts(
                report.id,
                organization_id,
                new Date(report.created_at)
            );
        } catch (alertError) {
            console.warn(
                '⚠️ Timeline alerts not scheduled:',
                alertError
            );
        }

        /* ------------------------------ Response ---------------------------- */

        res.status(201).json({
            message: 'Report submitted successfully',
            case_token: report.case_token,
            created_at: report.created_at
        });

    } catch (error) {
        console.error('Submit report error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/* -------------------------------------------------------------------------- */
/*                              GET REPORT STATUS                              */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/reports/:caseToken
 */
export async function getReportStatus(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const { caseToken } = req.params;
        const token = Array.isArray(caseToken) ? caseToken[0] : caseToken;

        if (!token || !isValidCaseToken(token)) {
            res.status(400).json({ error: 'Invalid case token format' });
            return;
        }

        const { data: report, error } = await supabase
            .from('reports')
            .select('status, incident_type, created_at, closed_at')
            .eq('case_token', token)
            .single();

        if (error || !report) {
            res.status(404).json({ error: 'Report not found' });
            return;
        }

        res.status(200).json(report);

    } catch (error) {
        console.error('Get report status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}