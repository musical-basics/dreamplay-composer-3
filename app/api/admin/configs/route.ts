import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'composer' } }
)

export async function GET() {
    // Read fresh on every request — avoids stale module-level caching
    const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const { userId } = await auth()
    if (!userId || !adminIds.includes(userId)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Two separate queries — avoids needing an explicit FK for embedded resource join
    const [configsRes, usersRes] = await Promise.all([
        supabase
            .from('configurations')
            .select('id, title, user_id, audio_url, xml_url, midi_url, is_published, created_at, updated_at')
            .order('updated_at', { ascending: false }),
        supabase
            .from('users')
            .select('id, email, first_name, last_name'),
    ])

    if (configsRes.error) {
        console.error('[admin/configs] configs error:', configsRes.error)
        return NextResponse.json({ error: configsRes.error.message }, { status: 500 })
    }
    if (usersRes.error) {
        console.error('[admin/configs] users error:', usersRes.error)
        return NextResponse.json({ error: usersRes.error.message }, { status: 500 })
    }

    const userMap = Object.fromEntries((usersRes.data ?? []).map(u => [u.id, u]))
    const configs = (configsRes.data ?? []).map(c => ({ ...c, users: userMap[c.user_id] ?? null }))

    return NextResponse.json({ configs })
}
