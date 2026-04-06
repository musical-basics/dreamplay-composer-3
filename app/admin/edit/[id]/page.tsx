import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'

const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)

export default async function AdminEditPage({ params }: { params: Promise<{ id: string }> }) {
    const { userId } = await auth()
    if (!userId || !ADMIN_IDS.includes(userId)) {
        return (
            <main className="min-h-screen bg-black flex items-center justify-center text-white">
                <p className="text-neutral-400">403 — Not authorized.</p>
            </main>
        )
    }

    const { id } = await params
    // Admin's fetchConfigById and updateConfigAction now bypass ownership —
    // so the regular studio2 editor works as-is for any config.
    redirect(`/studio2/edit/${id}`)
}
