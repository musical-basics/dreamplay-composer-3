/**
 * Activity Log Service — server-side only (service role key)
 * Logs user events to composer.activity_logs table.
 * Fire-and-forget: never throws, never blocks the calling request.
 */

import { createClient } from '@supabase/supabase-js'

type EventType =
    | 'user.login'
    | 'config.created'
    | 'config.opened'
    | 'config.viewed'

interface LogPayload {
    user_id?: string | null
    config_id?: string | null
    metadata?: Record<string, unknown>
}

function getSupabase() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { db: { schema: 'composer' } }
    )
}

export async function logActivity(event_type: EventType, payload: LogPayload = {}): Promise<void> {
    try {
        const sb = getSupabase()
        await sb.from('activity_logs').insert({
            event_type,
            user_id: payload.user_id ?? null,
            config_id: payload.config_id ?? null,
            metadata: payload.metadata ?? {},
        })
    } catch {
        // Non-fatal — never let logging break the main flow
    }
}

/**
 * Deduped login logger: only writes a log if this user hasn't had
 * a login event in the past 6 hours. Prevents spam on every page load.
 */
export async function logLoginIfNew(user_id: string, metadata?: Record<string, unknown>): Promise<void> {
    try {
        const sb = getSupabase()
        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()

        const { data } = await sb
            .from('activity_logs')
            .select('id')
            .eq('event_type', 'user.login')
            .eq('user_id', user_id)
            .gte('created_at', sixHoursAgo)
            .limit(1)
            .maybeSingle()

        if (!data) {
            await logActivity('user.login', { user_id, metadata })
        }
    } catch {
        // Non-fatal
    }
}
