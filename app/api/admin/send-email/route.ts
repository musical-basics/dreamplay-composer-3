import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { Resend } from 'resend'

const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)

export async function POST(req: NextRequest) {
    const { userId } = await auth()
    if (!userId || !ADMIN_IDS.includes(userId)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const json = await req.json()
    const { to, subject, body } = json as { to: string; subject: string; body: string }

    if (!to || !subject || !body) {
        return NextResponse.json({ error: 'Missing to, subject, or body' }, { status: 400 })
    }

    if (!process.env.RESEND_API_KEY) {
        return NextResponse.json({ error: 'RESEND_API_KEY is not configured' }, { status: 500 })
    }

    // Instantiate lazily so missing env var doesn't break the build
    const resend = new Resend(process.env.RESEND_API_KEY)

    const fromAddress = process.env.RESEND_FROM_EMAIL || 'DreamPlay Studio <noreply@dreamplay.studio>'

    try {
        const { data, error } = await resend.emails.send({
            from: fromAddress,
            to: [to],
            subject,
            text: body,
            html: `
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#0a0a0a;color:#f5f5f5;">
                    <div style="margin-bottom:24px;">
                        <span style="font-size:16px;font-weight:600;color:#fff;">DreamPlay Studio</span>
                    </div>
                    <div style="white-space:pre-wrap;font-size:15px;line-height:1.7;color:#e5e5e5;">${body.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                    <div style="margin-top:32px;padding-top:24px;border-top:1px solid #2a2a2a;font-size:12px;color:#666;">
                        You received this message because you have an account on DreamPlay Studio.<br/>
                        <a href="https://composer.dreamplay.studio" style="color:#a855f7;">composer.dreamplay.studio</a>
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
