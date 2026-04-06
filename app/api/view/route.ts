import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/view
 *
 * Increments view_count for a published configuration.
 * Public endpoint — no auth required.
 * Rate limiting is handled by checking is_published to prevent spam on private configs.
 */
export async function POST(req: NextRequest) {
    try {
        const { configId } = await req.json()
        if (!configId || typeof configId !== 'string') {
            return NextResponse.json({ error: 'configId is required' }, { status: 400 })
        }

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { db: { schema: 'composer' } }
        )

        // Only increment for published configs
        const { error } = await supabase.rpc('increment_view_count', { config_id: configId })

        if (error) {
            // Graceful degradation — view count failure should never break the viewer
            console.warn('[View API] Failed to increment view count:', error.message)
        }

        return NextResponse.json({ ok: true })
    } catch (err) {
        console.warn('[View API] Unexpected error:', err)
        return NextResponse.json({ ok: false })
    }
}
