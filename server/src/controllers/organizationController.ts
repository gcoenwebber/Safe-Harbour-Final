import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { generateUIN, hashEmail } from '../utils/identity';

/**
 * Generate a random 8-character alphanumeric invite code
 */
function generateInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding confusing chars: 0, O, 1, I
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

interface CreateOrganizationRequest {
    name: string;
    domain?: string;
    creator_email: string;
    creator_name: string;
    creator_password?: string;  // Optional password for Supabase Auth
}

/**
 * Create a new organization
 * POST /api/organizations
 * 
 * The creator is automatically assigned Admin + Presiding Officer roles
 */
export async function createOrganization(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const { name, domain, creator_email, creator_name, creator_password }: CreateOrganizationRequest = req.body;

        // Validate required fields
        if (!name || !creator_email || !creator_name) {
            res.status(400).json({
                error: 'Missing required fields',
                required: ['name', 'creator_email', 'creator_name']
            });
            return;
        }

        // Validate password if provided
        if (creator_password && creator_password.length < 6) {
            res.status(400).json({ error: 'Password must be at least 6 characters' });
            return;
        }

        // Check if organization name already exists
        const { data: existingOrg } = await supabase
            .from('organizations')
            .select('id')
            .eq('name', name)
            .single();

        if (existingOrg) {
            res.status(409).json({ error: 'Organization with this name already exists' });
            return;
        }

        // Create organization
        const { data: org, error: orgError } = await supabase
            .from('organizations')
            .insert({ name, domain })
            .select()
            .single();

        if (orgError) {
            console.error('Error creating organization:', orgError);
            res.status(500).json({ error: 'Failed to create organization' });
            return;
        }

        // Generate UIN for creator
        const sequentialId = Date.now() % 0xFFFFFFFF;
        const creatorUin = generateUIN(sequentialId);
        const emailHash = hashEmail(creator_email);

        // Check if user already exists
        const { data: existingUser } = await supabase
            .from('identity_mapping')
            .select('uin')
            .eq('email_hash', emailHash)
            .single();

        if (existingUser) {
            // User exists, update their org and roles
            await supabase
                .from('public_directory')
                .update({
                    organization_id: org.id,
                    role: 'Admin',
                    ic_role: 'presiding_officer'
                })
                .eq('uin', existingUser.uin);
        } else {
            // Create new user as Admin + Presiding Officer
            await supabase.from('public_directory').insert({
                uin: creatorUin,
                full_name: creator_name,
                role: 'Admin',
                ic_role: 'presiding_officer',
                organization_id: org.id
            });

            await supabase.from('identity_mapping').insert({
                email_hash: emailHash,
                uin: creatorUin,
                organization_id: org.id
            });

            // Create Supabase Auth user if password provided (so admin can login)
            // Only for NEW users - existing users may already have an auth account
            if (creator_password) {
                const { error: authError } = await supabase.auth.admin.createUser({
                    email: creator_email,
                    password: creator_password,
                    email_confirm: true,  // Auto-confirm email
                    user_metadata: {
                        full_name: creator_name,
                        uin: creatorUin,
                        organization_id: org.id,
                        role: 'Admin',
                        ic_role: 'presiding_officer'
                    }
                });

                if (authError) {
                    console.error('Error creating auth user:', authError);
                    // Don't fail the whole request, just log the error
                } else {
                    console.log(`✅ Auth user created for admin: ${creator_email}`);
                }
            }
        }

        // Update org with creator UIN
        await supabase
            .from('organizations')
            .update({ created_by_uin: existingUser?.uin || creatorUin })
            .eq('id', org.id);

        // Generate initial invite code for employees
        const inviteCode = generateInviteCode();
        await supabase.from('invite_codes').insert({
            organization_id: org.id,
            code: inviteCode,
            role: 'Employee',
            uses_remaining: -1, // Unlimited
            created_by_uin: existingUser?.uin || creatorUin
        });

        res.status(201).json({
            message: 'Organization created successfully',
            organization: {
                id: org.id,
                name: org.name,
                domain: org.domain
            },
            creator: {
                uin: existingUser?.uin || creatorUin,
                role: 'Admin',
                ic_role: 'presiding_officer'
            },
            invite_code: inviteCode
        });

    } catch (error) {
        console.error('Create organization error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

interface GenerateInviteRequest {
    role?: string;
    ic_role?: string;
    uses_limit?: number;
    expires_in_days?: number;
    actor_uin: string;
}

/**
 * Generate an invite code for an organization
 * POST /api/organizations/:orgId/invite
 */
export async function generateInvite(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const { orgId } = req.params;
        const { role = 'Employee', ic_role, uses_limit = -1, expires_in_days, actor_uin }: GenerateInviteRequest = req.body;

        if (!actor_uin) {
            res.status(400).json({ error: 'actor_uin is required' });
            return;
        }

        // Verify actor is Admin of this org
        const { data: actor } = await supabase
            .from('public_directory')
            .select('role, organization_id')
            .eq('uin', actor_uin)
            .single();

        if (!actor || actor.organization_id !== orgId || actor.role !== 'Admin') {
            res.status(403).json({ error: 'Only organization Admins can generate invite codes' });
            return;
        }

        // Generate unique invite code
        let code = generateInviteCode();
        let attempts = 0;
        while (attempts < 5) {
            const { data: existing } = await supabase
                .from('invite_codes')
                .select('id')
                .eq('code', code)
                .single();

            if (!existing) break;
            code = generateInviteCode();
            attempts++;
        }

        // Calculate expiry
        const expiresAt = expires_in_days
            ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000).toISOString()
            : null;

        // Create invite code
        const { data: invite, error } = await supabase
            .from('invite_codes')
            .insert({
                organization_id: orgId,
                code,
                role,
                ic_role,
                uses_remaining: uses_limit,
                expires_at: expiresAt,
                created_by_uin: actor_uin
            })
            .select()
            .single();

        if (error) {
            console.error('Error creating invite:', error);
            res.status(500).json({ error: 'Failed to create invite code' });
            return;
        }

        res.status(201).json({
            message: 'Invite code generated',
            invite_code: code,
            role,
            ic_role,
            uses_remaining: uses_limit === -1 ? 'unlimited' : uses_limit,
            expires_at: expiresAt
        });

    } catch (error) {
        console.error('Generate invite error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Validate an invite code and return organization info
 * GET /api/organizations/join/:code
 */
export async function validateInviteCode(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const { code } = req.params;
        const codeStr = Array.isArray(code) ? code[0] : code;

        if (!codeStr || codeStr.length !== 8) {
            res.status(400).json({ error: 'Invalid invite code format' });
            return;
        }

        // Find invite code
        const { data: invite, error } = await supabase
            .from('invite_codes')
            .select(`
                id,
                organization_id,
                role,
                ic_role,
                uses_remaining,
                expires_at,
                organizations (
                    id,
                    name,
                    domain
                )
            `)
            .eq('code', codeStr.toUpperCase())
            .single();

        if (error || !invite) {
            res.status(404).json({ error: 'Invalid invite code' });
            return;
        }

        // Check if expired
        if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
            res.status(410).json({ error: 'Invite code has expired' });
            return;
        }

        // Check uses remaining
        if (invite.uses_remaining === 0) {
            res.status(410).json({ error: 'Invite code has reached its usage limit' });
            return;
        }

        res.status(200).json({
            valid: true,
            organization: invite.organizations,
            role: invite.role,
            ic_role: invite.ic_role
        });

    } catch (error) {
        console.error('Validate invite error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Use an invite code during signup (internal helper)
 */
export async function useInviteCode(code: string): Promise<{
    organization_id: string;
    role: string;
    ic_role?: string;
} | null> {
    if (!supabase) return null;

    const { data: invite, error } = await supabase
        .from('invite_codes')
        .select('id, organization_id, role, ic_role, uses_remaining')
        .eq('code', code.toUpperCase())
        .single();

    if (error || !invite) return null;

    // Check uses remaining
    if (invite.uses_remaining === 0) return null;

    // Decrement uses if not unlimited
    if (invite.uses_remaining > 0) {
        await supabase
            .from('invite_codes')
            .update({
                uses_remaining: invite.uses_remaining - 1
            })
            .eq('id', invite.id);
    }

    return {
        organization_id: invite.organization_id,
        role: invite.role,
        ic_role: invite.ic_role
    };
}

/**
 * Get all invite codes for an organization (Admin only)
 * GET /api/organizations/:orgId/invites
 */
export async function getOrganizationInvites(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({ error: 'Database not configured' });
            return;
        }

        const { orgId } = req.params;
        const actorUin = req.query.actor_uin as string;

        if (!actorUin) {
            res.status(400).json({ error: 'actor_uin query param is required' });
            return;
        }

        // Verify actor is Admin
        const { data: actor } = await supabase
            .from('public_directory')
            .select('role, organization_id')
            .eq('uin', actorUin)
            .single();

        if (!actor || actor.organization_id !== orgId || actor.role !== 'Admin') {
            res.status(403).json({ error: 'Only organization Admins can view invite codes' });
            return;
        }

        const { data: invites, error } = await supabase
            .from('invite_codes')
            .select('*')
            .eq('organization_id', orgId)
            .order('created_at', { ascending: false });

        if (error) {
            res.status(500).json({ error: 'Failed to fetch invites' });
            return;
        }

        res.status(200).json(invites || []);

    } catch (error) {
        console.error('Get invites error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
