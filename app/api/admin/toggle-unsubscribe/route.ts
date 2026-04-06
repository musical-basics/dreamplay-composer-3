import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'

const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)

export async function POST(req: NextRequest) {
    const { userId } = await auth()
    if (!userId || !ADMIN_IDS.includes(userId)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { userId: targetId, unsubscribed } = await req.json() as {
        userId: string
        unsubscribed: boolean
    }

    if (!targetId) {
        return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { db: { schema: 'composer' } }
    )

    const { error } = await sb
        .from('users')
        .update({ email_unsubscribed: unsubscribed })
        .eq('id', targetId)

    if (error) {
        console.error('[toggle-unsubscribe] Supabase error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log(`[toggle-unsubscribe] ${targetId} → email_unsubscribed=${unsubscribed}`)
    return NextResponse.json({ success: true })
}
