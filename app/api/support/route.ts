import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { createR2Client, getR2PublicUrl } from '@/lib/r2'

const SUPPORT_TO = process.env.SUPPORT_EMAIL || process.env.RESEND_FROM_EMAIL || 'support@dreamplay.studio'
const SUPPORT_FROM = process.env.RESEND_FROM_EMAIL || 'DreamPlay Studio <noreply@dreamplay.studio>'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'composer' } }
)

export async function POST(req: NextRequest) {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Parse multipart form
    const formData = await req.formData()
    const message = (formData.get('message') as string | null)?.trim()
    const configId = (formData.get('configId') as string | null)?.trim()
    const file = formData.get('file') as File | null

    if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

    // Fetch user info for context
    const { data: userRow } = await supabase
        .from('users')
        .select('email, first_name, last_name')
        .eq('id', userId)
        .single()

    const senderName = [userRow?.first_name, userRow?.last_name].filter(Boolean).join(' ') || 'Unknown'
    const senderEmail = userRow?.email || 'unknown'

    // Upload attachment to R2 if provided
    let attachmentUrl: string | null = null
    if (file && file.size > 0) {
        try {
            const s3 = createR2Client()
            const ext = file.name.split('.').pop() || 'bin'
            const key = `support/${userId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
            const buffer = Buffer.from(await file.arrayBuffer())
            await s3.send(new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME!,
                Key: key,
                Body: buffer,
                ContentType: file.type || `application/octet-stream`,
            }))
            attachmentUrl = getR2PublicUrl(key)
        } catch (err) {
            console.warn('[support] Attachment upload failed:', err)
        }
    }

    if (!process.env.RESEND_API_KEY) {
        return NextResponse.json({ error: 'Email not configured' }, { status: 500 })
    }

    const resend = new Resend(process.env.RESEND_API_KEY)
    const configLink = configId
        ? `<a href="https://composer.dreamplay.studio/admin/view/${configId}" style="color:#a855f7;">View Config (${configId})</a>`
        : null

    const { error } = await resend.emails.send({
        from: SUPPORT_FROM,
        to: [SUPPORT_TO],
        replyTo: senderEmail !== 'unknown' ? senderEmail : undefined,
        subject: `[Support] Message from ${senderName}`,
        html: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#0a0a0a;color:#f5f5f5;">
                <h2 style="margin:0 0 16px;color:#fff;font-size:18px;">Support Request</h2>
                <table style="border-collapse:collapse;width:100%;margin-bottom:20px;font-size:13px;">
                    <tr><td style="color:#888;padding:4px 12px 4px 0;white-space:nowrap;">From</td><td style="color:#fff;">${senderName} &lt;${senderEmail}&gt;</td></tr>
                    <tr><td style="color:#888;padding:4px 12px 4px 0;white-space:nowrap;">User ID</td><td style="color:#fff;font-family:monospace;font-size:12px;">${userId}</td></tr>
                    ${configId ? `<tr><td style="color:#888;padding:4px 12px 4px 0;white-space:nowrap;">Config</td><td>${configLink}</td></tr>` : ''}
                    ${attachmentUrl ? `<tr><td style="color:#888;padding:4px 12px 4px 0;white-space:nowrap;">Attachment</td><td><a href="${attachmentUrl}" style="color:#a855f7;">${file?.name}</a></td></tr>` : ''}
                </table>
                <div style="background:#1a1a1a;border-radius:8px;padding:16px;white-space:pre-wrap;font-size:14px;line-height:1.6;color:#e5e5e5;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
            </div>
        `,
    })

    if (error) {
        console.error('[support] Resend error:', error)
        return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
}
