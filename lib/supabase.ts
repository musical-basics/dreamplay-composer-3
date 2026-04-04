import { createClient } from '@supabase/supabase-js'

/** Server-side Supabase client (service role) */
export function createServerSupabase() {
    return createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}

/** Browser-side Supabase client (anon key) — only for Realtime subscriptions */
export function createBrowserSupabase() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
}
