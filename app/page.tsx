import Link from 'next/link'

export default function Page() {
    return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-6">
            <h1 className="text-3xl font-bold">
                Live Audio Transcription Testing
            </h1>
            <Link
                href="/transcribe"
                className="px-6 py-3 bg-white text-black font-semibold rounded-lg hover:bg-neutral-200 transition-colors"
            >
                Go to Transcriber
            </Link>
        </main>
    )
}
