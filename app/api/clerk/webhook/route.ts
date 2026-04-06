import { Webhook } from 'svix'
import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import type { WebhookEvent } from '@clerk/nextjs/server'

function getSupabase() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { db: { schema: 'composer' } }
    )
}

export async function POST(req: Request) {
    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET
    if (!webhookSecret) {
        return new Response('Webhook secret not configured', { status: 500 })
    }

    // Verify Clerk webhook signature via svix
    const headerPayload = await headers()
    const svixId = headerPayload.get('svix-id')
    const svixTimestamp = headerPayload.get('svix-timestamp')
    const svixSignature = headerPayload.get('svix-signature')

    if (!svixId || !svixTimestamp || !svixSignature) {
        return new Response('Missing svix headers', { status: 400 })
    }

    const body = await req.text()
    const wh = new Webhook(webhookSecret)

    let event: WebhookEvent
    try {
        event = wh.verify(body, {
            'svix-id': svixId,
            'svix-timestamp': svixTimestamp,
            'svix-signature': svixSignature,
        }) as WebhookEvent
    } catch {
        return new Response('Invalid webhook signature', { status: 400 })
    }

    const supabase = getSupabase()

    if (event.type === 'user.created' || event.type === 'user.updated') {
        const { id, email_addresses, first_name, last_name, image_url, created_at, updated_at } = event.data
        const primaryEmail = email_addresses?.find(e => e.id === event.data.primary_email_address_id)?.email_address
            ?? email_addresses?.[0]?.email_address
            ?? null

        const { error } = await supabase
            .from('users')
            .upsert({
                id,
                email: primaryEmail,
                first_name: first_name ?? null,
                last_name: last_name ?? null,
                image_url: image_url ?? null,
                created_at: created_at ? new Date(created_at).toISOString() : new Date().toISOString(),
                updated_at: updated_at ? new Date(updated_at).toISOString() : new Date().toISOString(),
            }, { onConflict: 'id' })

        if (error) {
            console.error('[Clerk Webhook] Failed to upsert user:', error)
            return new Response('DB error: ' + error.message, { status: 500 })
        }

        console.log(`[Clerk Webhook] Synced user ${id} (${primaryEmail})`)
    }

    if (event.type === 'user.deleted') {
        const { id } = event.data
        if (id) {
            await supabase.from('users').delete().eq('id', id)
            console.log(`[Clerk Webhook] Deleted user ${id}`)
        }
    }

    return new Response('OK', { status: 200 })
}
