import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { Resend } from 'resend'

const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://composer.dreamplay.studio'

export async function POST(req: NextRequest) {
    const { userId: adminId } = await auth()
    if (!adminId || !ADMIN_IDS.includes(adminId)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const json = await req.json()
    const { to, name, userId, subject, body } = json as {
        to: string
        name?: string
        userId?: string
        subject: string
        body: string
    }

    if (!to || !subject || !body) {
        return NextResponse.json({ error: 'Missing to, subject, or body' }, { status: 400 })
    }

    if (!process.env.RESEND_API_KEY) {
        return NextResponse.json({ error: 'RESEND_API_KEY is not configured' }, { status: 500 })
    }

    // Look up name server-side — don't trust client-passed name (may be stale/empty)
    let recipientName = name?.trim() || ''
    if (userId && !recipientName) {
        try {
            const { createClient } = await import('@supabase/supabase-js')
            const sb = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!,
                { db: { schema: 'composer' } }
            )
            const { data } = await sb
                .from('users')
                .select('first_name, last_name, email')
                .eq('id', userId)
                .single()
            if (data) {
                const fromDb = [data.first_name, data.last_name].filter(Boolean).join(' ')
                recipientName = fromDb || data.email || ''
            }
        } catch {
            // non-fatal
        }
    }
    if (!recipientName) recipientName = 'there'

    console.log('[send-email] recipientName for', to, '→', recipientName)

    const personalSubject = subject.replace(/\{\{name\}\}/g, recipientName)
    const personalBody = body.replace(/\{\{name\}\}/g, recipientName)

    const resend = new Resend(process.env.RESEND_API_KEY)
    const fromAddress = process.env.RESEND_FROM_EMAIL || 'DreamPlay Studio <noreply@dreamplay.studio>'

    // Unsubscribe link (includes userId for one-click opt-out)
    const unsubscribeUrl = userId
        ? `${BASE_URL}/unsubscribe?uid=${userId}`
        : `${BASE_URL}/unsubscribe`

    try {
        const { data, error } = await resend.emails.send({
            from: fromAddress,
            to: [to],
            subject: personalSubject,
            headers: {
                'List-Unsubscribe': `<${unsubscribeUrl}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
            text: `${personalBody}\n\n---\nYou received this because you have an account on DreamPlay Studio.\nDon't want to receive these emails? Unsubscribe: ${unsubscribeUrl}`,
            html: `
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#0a0a0a;color:#f5f5f5;">
                    <div style="margin-bottom:24px;">
                        <span style="font-size:16px;font-weight:600;color:#fff;">DreamPlay Studio</span>
                    </div>
                    <div style="white-space:pre-wrap;font-size:15px;line-height:1.7;color:#e5e5e5;">${personalBody.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                    <div style="margin-top:32px;padding-top:24px;border-top:1px solid #2a2a2a;font-size:12px;color:#666;line-height:1.6;">
                        You received this because you have an account on
                        <a href="${BASE_URL}" style="color:#a855f7;">DreamPlay Studio</a>.<br/>
                        Don&apos;t want to receive these emails?
                        <a href="${unsubscribeUrl}" style="color:#a855f7;">Unsubscribe here</a>
                    </div>
                </div>
            `,
        })

        if (error) {
            console.error('[admin/send-email] Resend error:', error)
            return NextResponse.json({ error: (error as { message?: string }).message ?? 'Send failed' }, { status: 500 })
        }

        console.log('[admin/send-email] Sent to', to, 'id:', data?.id)
        return NextResponse.json({ success: true, id: data?.id })
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Send failed'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
