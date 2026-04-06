import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
    const uid = req.nextUrl.searchParams.get('uid')

    if (uid) {
        try {
            const sb = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!,
                { db: { schema: 'composer' } }
            )
            // Try to mark unsubscribed — silently ignores if column doesn't exist
            await sb
                .from('users')
                .update({ email_unsubscribed: true })
                .eq('id', uid)
        } catch (err) {
            // Non-fatal — page still confirms to the user
            console.warn('[unsubscribe] DB update failed:', err)
        }
    }

    // Redirect to the confirmation page
    return NextResponse.redirect(new URL('/unsubscribe/done', req.url))
}
