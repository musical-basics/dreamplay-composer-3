import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// GET /api/forums/users?ids=id1,id2,id3
// Returns display name info for a list of user IDs (public, for forum attribution)
export async function GET(req: NextRequest) {
    const idsParam = req.nextUrl.searchParams.get('ids')
    if (!idsParam) return NextResponse.json({ users: {} })

    const ids = idsParam.split(',').filter(Boolean).slice(0, 100) // max 100

    const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { db: { schema: 'composer' } }
    )

    const { data } = await sb
        .from('users')
        .select('id, first_name, last_name, email')
        .in('id', ids)

    // Also check profiles for custom_username
    const { data: profiles } = await sb
        .from('profiles')
        .select('user_id, custom_username, display_name, avatar_url')
        .in('user_id', ids)

    const profileMap: Record<string, { custom_username?: string; display_name?: string; avatar_url?: string }> = {}
    for (const p of profiles ?? []) {
        profileMap[p.user_id] = p
    }

    // Build a map: userId → { name, avatarUrl }
    const result: Record<string, { name: string; avatarUrl?: string }> = {}
    for (const u of data ?? []) {
        const profile = profileMap[u.id]
        const name =
            profile?.custom_username ||
            profile?.display_name ||
            [u.first_name, u.last_name].filter(Boolean).join(' ') ||
            u.email?.split('@')[0] ||
            `user-${u.id.slice(-6)}`
        result[u.id] = { name: `@${name}`, avatarUrl: profile?.avatar_url }
    }

    return NextResponse.json({ users: result })
}
