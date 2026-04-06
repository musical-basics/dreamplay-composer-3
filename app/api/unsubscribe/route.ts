import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://composer.dreamplay.studio'

export async function GET(req: NextRequest) {
    const uid = req.nextUrl.searchParams.get('uid')

    if (uid) {
        try {
            const sb = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!,
                { db: { schema: 'composer' } }
            )
            // Try to mark unsubscribed — silently ignores if column doesn't exist yet
            await sb
                .from('users')
                .update({ email_unsubscribed: true })
                .eq('id', uid)
        } catch (err) {
            // Non-fatal — confirmation page still shown
            console.warn('[unsubscribe] DB update failed:', err)
        }
    }

    // Use absolute BASE_URL to avoid Next.js relative-URL crash
    return NextResponse.redirect(`${BASE_URL}/unsubscribe/done`)
}
