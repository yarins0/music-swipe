import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
};

// Used exclusively for database queries — auth methods must never be called on this instance.
// Keeping auth and DB operations on separate instances prevents auth.getUser() from
// overwriting this client's Authorization header with the user's JWT via the auth state
// change listener, which would cause queries to run as 'authenticated' instead of 'service_role'.
export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, clientOptions);

// Used exclusively for JWT verification (auth.getUser). Never used for database queries.
export const supabaseAuth = createClient(supabaseUrl, supabaseServiceRoleKey, clientOptions);
