import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'

const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'composer' } }
)

export async function GET() {
    const { userId } = await auth()
    if (!userId || !ADMIN_IDS.includes(userId)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Fetch all configs with joined user info
    const { data, error } = await supabase
        .from('configurations')
        .select(`
            id,
            title,
            user_id,
            audio_url,
            xml_url,
            midi_url,
            is_published,
            created_at,
            updated_at,
            users:user_id (
                email,
                first_name,
                last_name
            )
        `)
        .order('updated_at', { ascending: false })

    if (error) {
        console.error('[admin/configs] Supabase error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ configs: data ?? [] })
}
