import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { Resend } from 'resend'

const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://composer.dreamplay.studio'
const BATCH_SIZE = 100 // Resend batch limit

interface Recipient {
    email: string
    name: string
    userId?: string
}

function buildEmailPayload(
    recipient: Recipient,
    subject: string,
    body: string,
    fromAddress: string,
) {
    const safeName = recipient.name || 'there'
    const personalSubject = subject.replace(/\{\{name\}\}/g, safeName)
    const personalBody = body.replace(/\{\{name\}\}/g, safeName)
    const unsubscribeUrl = recipient.userId
        ? `${BASE_URL}/unsubscribe?uid=${recipient.userId}`
        : `${BASE_URL}/unsubscribe`

    return {
        from: fromAddress,
        to: [recipient.email],
        subject: personalSubject,
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
    }
}

export async function POST(req: NextRequest) {
    const { userId: adminId } = await auth()
    if (!adminId || !ADMIN_IDS.includes(adminId)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    if (!process.env.RESEND_API_KEY) {
        return NextResponse.json({ error: 'RESEND_API_KEY is not configured' }, { status: 500 })
    }

    const json = await req.json()
    const { recipients, subject, body } = json as {
        recipients: Recipient[]
        subject: string
        body: string
    }

    if (!recipients?.length || !subject?.trim() || !body?.trim()) {
        return NextResponse.json({ error: 'Missing recipients, subject, or body' }, { status: 400 })
    }

    const resend = new Resend(process.env.RESEND_API_KEY)
    const fromAddress = process.env.RESEND_FROM_EMAIL || 'DreamPlay Studio <noreply@dreamplay.studio>'

    const results: { email: string; status: 'sent' | 'failed'; error?: string }[] = []

    // Send in batches of 100 (Resend batch limit)
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
        const batch = recipients.slice(i, i + BATCH_SIZE)
        const payloads = batch.map(r => buildEmailPayload(r, subject, body, fromAddress))

        try {
            const { data, error } = await resend.batch.send(payloads)
            if (error) throw new Error((error as { message?: string }).message ?? 'Batch send failed')
            // data.data is an array of {id} — one per email in the batch
            batch.forEach((r) => results.push({ email: r.email, status: 'sent' }))
            console.log(`[send-bulk] Batch ${Math.floor(i / BATCH_SIZE) + 1}: sent ${batch.length} emails`)
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error'
            console.error(`[send-bulk] Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, message)
            batch.forEach((r) => results.push({ email: r.email, status: 'failed', error: message }))
        }

        // Small pause between batches to respect rate limits
        if (i + BATCH_SIZE < recipients.length) {
            await new Promise(r => setTimeout(r, 500))
        }
    }

    const sent = results.filter(r => r.status === 'sent').length
    const failed = results.filter(r => r.status === 'failed').length

    return NextResponse.json({ results, sent, failed })
}
