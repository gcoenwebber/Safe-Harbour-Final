import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

/**
 * Search public directory for @mention autocomplete
 * GET /api/directory/search?q=query&org=organization_id
 */
export async function searchDirectory(req: Request, res: Response): Promise<void> {
    try {
        if (!supabase) {
            res.status(503).json({
                error: 'Database not configured',
                message: 'Please configure Supabase credentials in server/.env'
            });
            return;
        }

        const { q, org } = req.query;

        if (!q || typeof q !== 'string') {
            res.status(400).json({ error: 'Search query is required' });
            return;
        }

        // Build the query
        let query = supabase
            .from('public_directory')
            .select('uin, full_name, role, organization_id')
            .ilike('full_name', `%${q}%`)
            .limit(10);

        // Filter by organization if provided
        if (org && typeof org === 'string') {
            console.log('[DirectorySearch] Filtering by org:', org);
            query = query.eq('organization_id', org);
        }

        const { data, error } = await query;

        if (error) {
            console.error('[DirectorySearch] Supabase error:', error);
            console.error('[DirectorySearch] Error details:', JSON.stringify(error, null, 2));
            res.status(500).json({ error: 'Failed to search directory', details: error.message });
            return;
        }

        // Format results for react-mentions
        const results = (data || []).map((user) => ({
            id: user.uin,
            display: user.full_name,
            role: user.role
        }));

        res.status(200).json(results);

    } catch (error) {
        console.error('Directory search error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
