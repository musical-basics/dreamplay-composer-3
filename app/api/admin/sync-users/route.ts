import { clerkClient } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'
import { auth } from '@clerk/nextjs/server'

function getSupabase() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { db: { schema: 'composer' } }
    )
}

// Admin-only endpoint: GET /api/admin/sync-users
// Paginates through ALL Clerk users and upserts them into composer.users
export async function GET() {
    const { userId } = await auth()
    if (!userId) return new Response('Unauthorized', { status: 401 })

    const supabase = getSupabase()
    const client = await clerkClient()

    let synced = 0
    let failed = 0
    let page = 1
    const limit = 100

    while (true) {
        const response = await client.users.getUserList({ limit, offset: (page - 1) * limit })
        const users = response.data
        if (users.length === 0) break

        for (const user of users) {
            const primaryEmail = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress
                ?? user.emailAddresses[0]?.emailAddress
                ?? null

            const { error } = await supabase
                .from('users')
                .upsert({
                    id: user.id,
                    email: primaryEmail,
                    first_name: user.firstName ?? null,
                    last_name: user.lastName ?? null,
                    image_url: user.imageUrl ?? null,
                    created_at: new Date(user.createdAt).toISOString(),
                    updated_at: new Date(user.updatedAt).toISOString(),
                }, { onConflict: 'id' })

            if (error) {
                console.error(`[Sync] Failed for ${user.id}:`, error.message)
                failed++
            } else {
                synced++
            }
        }

        if (users.length < limit) break
        page++
    }

    return Response.json({ synced, failed, message: `Synced ${synced} users, ${failed} failed.` })
}
