'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createNewConfig } from '@/app/actions/config'

export default function StudioPage() {
    const router = useRouter()
    const [creating, setCreating] = useState(false)

    async function handleCreate() {
        setCreating(true)
        try {
            const config = await createNewConfig('Live Audio Test')
            router.push(`/studio/edit/${config.id}`)
        } catch (err) {
            console.error('Failed to create config:', err)
            setCreating(false)
        }
    }

    return (
        <main className="min-h-screen flex flex-col items-center justify-center gap-6 bg-black text-white">
            <h1 className="text-3xl font-bold">DreamPlay Composer 3</h1>
            <p className="text-neutral-400">Live Audio Transcription Testing</p>
            <button
                onClick={handleCreate}
                disabled={creating}
                className="px-8 py-4 bg-white text-black font-semibold rounded-lg hover:bg-neutral-200 disabled:opacity-50 transition-colors text-lg"
            >
                {creating ? 'Creating...' : 'New Project'}
            </button>
        </main>
    )
}
