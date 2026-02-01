import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase: SupabaseClient | null = null;

if (!supabaseUrl || !supabaseServiceKey ||
    supabaseUrl === 'your_supabase_project_url' ||
    supabaseServiceKey === 'your_supabase_service_role_key') {
    console.warn('⚠️  Warning: Supabase credentials not configured. Database operations will fail.');
    console.warn('   Please update SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env');
} else {
    // Create Supabase client with service role key for backend operations
    // This bypasses RLS - use with caution and only for trusted backend operations
    supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
}

export { supabase };
export default supabase;
