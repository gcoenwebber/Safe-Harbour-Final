import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { generateUIN, hashEmail } from '../utils/identity';
import { useInviteCode } from './organizationController';
import { createClient } from '@supabase/supabase-js';

// Admin client for updating user metadata
const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_URL
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

interface WebhookPayload {
    type: 'INSERT' | 'UPDATE' | 'DELETE';
    table: string;
    record: {
        id: string;
        email: string;
        raw_user_meta_data?: {
            full_name?: string;
            organization_id?: string;
            org_code?: string;
        };
    };
    old_record?: unknown;
}

/**
 * Webhook handler for Supabase Auth user creation
 * POST /api/auth/webhook
 * 
 * This is triggered by a Supabase Database Webhook on auth.users INSERT
 * 
 * Actions:
 * 1. Validate/use org code to get organization_id
 * 2. Generate UIN (non-enumerable)
 * 3. Create email hash (blind index)
 * 4. Insert into public_directory and identity_mapping
 * 5. Update user's app_metadata with uin and organization_id
 */
export async function handleAuthWebhook(req: Request, res: Response): Promise<void> {
    try {
        // Verify webhook secret (optional but recommended)
        const webhookSecret = req.headers['x-webhook-secret'];
        if (process.env.WEBHOOK_SECRET && webhookSecret !== process.env.WEBHOOK_SECRET) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const payload: WebhookPayload = req.body;

        // Only handle INSERT events on auth.users
        if (payload.type !== 'INSERT' || payload.table !== 'users') {
            res.status(200).json({ message: 'Ignored: not a user insert' });
            return;
        }

        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const { id: userId, email, raw_user_meta_data } = payload.record;
        const orgCode = raw_user_meta_data?.org_code;
        let organizationId = raw_user_meta_data?.organization_id;
        let role = 'Employee';
        let icRole: string | undefined;

        // If org code provided, validate and use it
        if (orgCode && !organizationId) {
            const inviteData = await useInviteCode(orgCode);
            if (inviteData) {
                organizationId = inviteData.organization_id;
                role = inviteData.role;
                icRole = inviteData.ic_role;
            }
        }

        // If still no organization, check email domain
        if (!organizationId && email) {
            const domain = email.split('@')[1];
            const { data: org } = await supabase
                .from('organizations')
                .select('id')
                .eq('domain', domain)
                .single();

            if (org) {
                organizationId = org.id;
            }
        }

        // Cannot proceed without organization
        if (!organizationId) {
            console.warn('User signup without valid org:', email);
            res.status(200).json({ message: 'User created but not linked to org' });
            return;
        }

        // Generate UIN
        const sequentialId = Date.now() % 0xFFFFFFFF;
        const uin = generateUIN(sequentialId);
        const emailHash = hashEmail(email);
        const fullName = raw_user_meta_data?.full_name || email.split('@')[0];

        // Check if user already exists in identity_mapping
        const { data: existingUser } = await supabase
            .from('identity_mapping')
            .select('uin')
            .eq('email_hash', emailHash)
            .single();

        if (existingUser) {
            // User already exists, just update app_metadata
            if (supabaseAdmin) {
                await supabaseAdmin.auth.admin.updateUserById(userId, {
                    app_metadata: {
                        uin: existingUser.uin,
                        organization_id: organizationId,
                        role,
                        ic_role: icRole
                    }
                });
            }
            res.status(200).json({ message: 'Existing user linked', uin: existingUser.uin });
            return;
        }

        // Create public_directory entry
        const { error: dirError } = await supabase.from('public_directory').insert({
            uin,
            full_name: fullName,
            role,
            ic_role: icRole,
            organization_id: organizationId
        });

        if (dirError) {
            console.error('Error creating directory entry:', dirError);
            res.status(500).json({ error: 'Failed to create directory entry' });
            return;
        }

        // Create identity_mapping entry
        const { error: mapError } = await supabase.from('identity_mapping').insert({
            email_hash: emailHash,
            uin,
            organization_id: organizationId
        });

        if (mapError) {
            // Rollback directory entry
            await supabase.from('public_directory').delete().eq('uin', uin);
            console.error('Error creating identity mapping:', mapError);
            res.status(500).json({ error: 'Failed to create identity mapping' });
            return;
        }

        // Update user's app_metadata with uin and org info
        if (supabaseAdmin) {
            const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
                app_metadata: {
                    uin,
                    organization_id: organizationId,
                    role,
                    ic_role: icRole
                }
            });

            if (metaError) {
                console.error('Error updating user metadata:', metaError);
            }
        } else {
            console.warn('Admin client not configured, cannot update user metadata');
        }

        console.log(`✅ User created: ${uin} (${role}) in org ${organizationId}`);

        res.status(200).json({
            message: 'User created successfully',
            uin,
            organization_id: organizationId,
            role
        });

    } catch (error) {
        console.error('Auth webhook error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export default handleAuthWebhook;
