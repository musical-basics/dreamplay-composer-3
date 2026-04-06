import { createClient } from '@supabase/supabase-js'

export default async function UnsubscribePage({
    searchParams,
}: {
    searchParams: Promise<{ uid?: string }>
}) {
    const { uid } = await searchParams
    let success = false

    if (uid) {
        try {
            const sb = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!,
                { db: { schema: 'composer' } }
            )
            const { error } = await sb
                .from('users')
                .update({ email_unsubscribed: true })
                .eq('id', uid)
            success = !error
        } catch {
            // render the page regardless
        }
    }

    return (
        <main className="min-h-screen bg-black flex items-center justify-center p-6">
            <div className="max-w-md text-center space-y-5">
                <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center mx-auto text-3xl select-none">
                    ✓
                </div>
                <h1 className="text-2xl font-semibold text-white">
                    {success ? "You've been unsubscribed" : 'Unsubscribe request received'}
                </h1>
                <p className="text-sm text-neutral-400 leading-relaxed">
                    {success
                        ? "You won't receive any more marketing emails from DreamPlay Studio."
                        : "We've noted your request and will remove you from future emails."}
                    {' '}Changed your mind?{' '}
                    <a
                        href="https://composer.dreamplay.studio"
                        className="text-purple-400 hover:underline"
                    >
                        Go back to Studio
                    </a>
                </p>
            </div>
        </main>
    )
}
