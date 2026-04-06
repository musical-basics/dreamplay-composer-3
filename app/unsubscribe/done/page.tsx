export default function UnsubscribeDonePage() {
    return (
        <main className="min-h-screen bg-black flex items-center justify-center p-6">
            <div className="max-w-md text-center space-y-4">
                <div className="w-14 h-14 rounded-full bg-green-500/15 flex items-center justify-center mx-auto text-2xl">✓</div>
                <h1 className="text-xl font-semibold text-white">You've been unsubscribed</h1>
                <p className="text-sm text-neutral-400 leading-relaxed">
                    You won't receive any more emails from DreamPlay Studio.{' '}
                    Changed your mind?{' '}
                    <a href="https://composer.dreamplay.studio" className="text-purple-400 hover:underline">
                        Visit your Studio
                    </a>{' '}
                    to manage your account.
                </p>
            </div>
        </main>
    )
}
