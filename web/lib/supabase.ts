import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
export const supabaseAdmin = () => {
  // without the server key nothing can be saved: say so clearly instead of crashing
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('The server is not configured yet (missing SUPABASE_SERVICE_ROLE_KEY on Vercel).');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
};
