// server/controllers/authController.ts
import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { generateUIN, hashEmail, isValidEmail } from '../utils/identity';
import { useInviteCode } from './organizationController';

interface SignupRequest {
    email: string;
    full_name: string;
    username: string;          // NEW: required for mentions
    role?: string;
    organization_id?: string;
    invite_code?: string;
}

/**
 * Signup Controller
 * Handles user registration:
 * 1. Validates input
 * 2. Hashes email for privacy
 * 3. Generates a non-enumerable UIN
 * 4. Inserts into identity_mapping and public_directory
 */
export async function signup(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({
                error: 'Database not configured',
                message: 'Please configure Supabase credentials in server/.env'
            });
            return;
        }

        const { email, full_name, username, role, organization_id, invite_code }: SignupRequest = req.body;

        // --- Validate required fields ---
        if (!email || !full_name || !username) {
            res.status(400).json({
                error: 'Missing required fields',
                required: ['email', 'full_name', 'username']
            });
            return;
        }

        // Validate email format
        if (!isValidEmail(email)) {
            res.status(400).json({ error: 'Invalid email format' });
            return;
        }

        // Validate username format
        const usernameRegex = /^[a-zA-Z0-9._-]+$/;
        if (!usernameRegex.test(username)) {
            res.status(400).json({ error: 'Invalid username format. Only letters, numbers, dots, underscores, and dashes allowed.' });
            return;
        }

        // Either invite_code OR (role + organization_id) must be provided
        if (!invite_code && (!role || !organization_id)) {
            res.status(400).json({
                error: 'Either invite_code OR (role + organization_id) must be provided'
            });
            return;
        }

        // --- Resolve invite code if provided ---
        let finalRole = role || 'Employee';
        let finalOrgId = organization_id;
        let icRole: string | undefined;

        if (invite_code) {
            const inviteData = await useInviteCode(invite_code);
            if (!inviteData) {
                res.status(400).json({ error: 'Invalid or expired invite code' });
                return;
            }
            finalOrgId = inviteData.organization_id;
            finalRole = inviteData.role;
            icRole = inviteData.ic_role;
        }

        if (!finalOrgId) {
            res.status(400).json({ error: 'organization_id is required' });
            return;
        }

        // --- Hash email for blind indexing ---
        const emailHash = hashEmail(email);

        // --- Check if user/email already exists ---
        const { data: existingUser } = await supabase
            .from('identity_mapping')
            .select('uin')
            .eq('email_hash', emailHash)
            .single();

        if (existingUser) {
            res.status(409).json({ error: 'User with this email already exists' });
            return;
        }

        // --- Check if username is already taken ---
        const { data: existingUsername } = await supabase
            .from('identity_mapping')
            .select('uin')
            .eq('username', username.toLowerCase())
            .single();

        if (existingUsername) {
            res.status(409).json({ error: 'Username already taken' });
            return;
        }

        // --- Generate non-enumerable UIN ---
        const sequentialId = Date.now() % 0xFFFFFFFF; // 32-bit
        const uin = generateUIN(sequentialId);

        // --- Insert into public_directory (no email stored) ---
        const { data: directoryEntry, error: directoryError } = await supabase
            .from('public_directory')
            .insert({
                uin,
                full_name,
                role: finalRole,
                ic_role: icRole,
                organization_id: finalOrgId
            })
            .select()
            .single();

        if (directoryError) {
            console.error('Error creating directory entry:', directoryError);
            res.status(500).json({
                error: 'Failed to create user directory entry',
                details: directoryError.message
            });
            return;
        }

        // --- Insert into identity_mapping ---
        const { error: mappingError } = await supabase
            .from('identity_mapping')
            .insert({
                email_hash: emailHash,
                username: username.toLowerCase(), // ✅ stored for mentions
                uin,
                organization_id: finalOrgId
            });

        if (mappingError) {
            // Rollback public_directory entry
            await supabase
                .from('public_directory')
                .delete()
                .eq('uin', uin);

            console.error('Error creating identity mapping:', mappingError);
            res.status(500).json({
                error: 'Failed to create identity mapping',
                details: mappingError.message
            });
            return;
        }

        // --- Success ---
        res.status(201).json({
            message: 'User registered successfully',
            user: {
                uin,
                full_name,
                username: username.toLowerCase(),
                role: finalRole,
                ic_role: icRole,
                organization_id: finalOrgId
            }
        });

    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}

/**
 * Lookup user by email (for internal use)
 * Returns the UIN without exposing email
 */
export async function lookupByEmail(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({
                error: 'Database not configured',
                message: 'Please configure Supabase credentials in server/.env'
            });
            return;
        }

        const { email } = req.body;

        if (!email || !isValidEmail(email)) {
            res.status(400).json({ error: 'Valid email is required' });
            return;
        }

        const emailHash = hashEmail(email);

        const { data, error } = await supabase
            .from('identity_mapping')
            .select('uin, organization_id, username')
            .eq('email_hash', emailHash)
            .single();

        if (error || !data) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const { data: userInfo } = await supabase
            .from('public_directory')
            .select('uin, full_name, role, organization_id')
            .eq('uin', data.uin)
            .single();

        res.status(200).json({ user: { ...userInfo, username: data.username } });

    } catch (error) {
        console.error('Lookup error:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}