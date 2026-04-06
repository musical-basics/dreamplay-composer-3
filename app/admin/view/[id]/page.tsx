import { notFound, redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { ViewerPage } from '@/components/viewer/ViewerPage'
import { getAuthorDisplayNameAction } from '@/app/actions/profile'
import { getConfigByIdInternal } from '@/lib/services/configService'

const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

export default async function AdminViewPage({ params }: { params: Promise<{ id: string }> }) {
    const { userId } = await auth()
    if (!userId) redirect('/sign-in')

    // Only allow explicitly listed admin user IDs
    if (ADMIN_IDS.length === 0 || !ADMIN_IDS.includes(userId)) {
        return (
            <main className="min-h-screen bg-black flex items-center justify-center text-white">
                <p className="text-neutral-400">403 — Not authorized.</p>
            </main>
        )
    }

    const { id } = await params
    const config = await getConfigByIdInternal(id)
    if (!config) notFound()

    const authorName = config.user_id
        ? await getAuthorDisplayNameAction(config.user_id)
        : null

    return (
        <div className="relative">
            <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-black text-center text-xs font-bold py-1 px-4">
                🔒 ADMIN VIEW — {config.is_published ? 'Published' : 'Private'} · Owner: {authorName ?? config.user_id}
            </div>
            <div className="pt-6">
                <ViewerPage config={config} authorName={authorName} />
            </div>
        </div>
    )
}
