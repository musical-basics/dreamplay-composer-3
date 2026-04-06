import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'

const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)

export async function GET(req: Request) {
    const { userId } = await auth()
    if (!userId || !ADMIN_IDS.includes(userId)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const url = new URL(req.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100'), 500)
    const offset = parseInt(url.searchParams.get('offset') ?? '0')
    const eventType = url.searchParams.get('event_type') ?? ''

    const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { db: { schema: 'composer' } }
    )

    // Fetch logs
    let logsQuery = sb
        .from('activity_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

    if (eventType) logsQuery = logsQuery.eq('event_type', eventType)

    const { data: logs, error, count } = await logsQuery
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Collect unique user_ids and config_ids
    const userIds = [...new Set((logs ?? []).map(l => l.user_id).filter(Boolean))]
    const configIds = [...new Set((logs ?? []).map(l => l.config_id).filter(Boolean))]

    // Batch-fetch user display names
    const userMap: Record<string, { displayName: string; email: string }> = {}
    if (userIds.length > 0) {
        const { data: users } = await sb
            .from('users')
            .select('id, email, first_name, last_name')
            .in('id', userIds)
        for (const u of users ?? []) {
            userMap[u.id] = {
                displayName: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || u.id,
                email: u.email ?? '',
            }
        }
    }

    // Batch-fetch config titles
    const configMap: Record<string, string> = {}
    if (configIds.length > 0) {
        const { data: configs } = await sb
            .from('song_configs')
            .select('id, title')
            .in('id', configIds)
        for (const c of configs ?? []) {
            configMap[c.id] = c.title ?? 'Untitled'
        }
    }

    return NextResponse.json({
        logs: logs ?? [],
        userMap,
        configMap,
        total: count ?? 0,
    })
}
