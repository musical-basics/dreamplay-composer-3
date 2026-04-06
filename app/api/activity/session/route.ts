import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { logLoginIfNew } from '@/lib/services/activityLogService'

/**
 * POST /api/activity/session
 * Called client-side (once per 6h per user) to log a login event.
 * Uses logLoginIfNew to deduplicate — safe to call on every page load.
 */
export async function POST() {
    try {
        const { userId } = await auth()
        if (!userId) return NextResponse.json({ ok: false })

        await logLoginIfNew(userId)
        return NextResponse.json({ ok: true })
    } catch {
        return NextResponse.json({ ok: false })
    }
}
