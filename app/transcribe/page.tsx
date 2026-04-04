'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

type TranscriptionState =
    | 'idle'
    | 'uploading'
    | 'queued'
    | 'transcribing'
    | 'completed'
    | 'error'

export default function TranscribePage() {
    const [configId] = useState(() => crypto.randomUUID())
    const [state, setState] = useState<TranscriptionState>('idle')
    const [audioFile, setAudioFile] = useState<File | null>(null)
    const [audioUrl, setAudioUrl] = useState<string | null>(null)
    const [midiUrl, setMidiUrl] = useState<string | null>(null)
    const [jobId, setJobId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [logs, setLogs] = useState<string[]>([])
    const [progress, setProgress] = useState<{ percent: number; stage: string } | null>(null)
    const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
    const logRef = useRef<HTMLDivElement>(null)

    const log = useCallback((msg: string) => {
        const ts = new Date().toLocaleTimeString()
        setLogs((prev) => [...prev, `[${ts}] ${msg}`])
        // auto-scroll
        setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }), 50)
    }, [])

    // -----------------------------------------------------------------------
    // Supabase Realtime — watch for midi_url to populate
    // -----------------------------------------------------------------------
    useEffect(() => {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        if (!url || !key) return

        const sb = createClient(url, key)
        supabaseRef.current = sb

        const channel = sb
            .channel(`configurations:${configId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'composer',
                    table: 'configurations',
                    filter: `id=eq.${configId}`,
                },
                (payload) => {
                    const newMidiUrl = payload.new?.midi_url
                    if (newMidiUrl) {
                        log(`MIDI ready: ${newMidiUrl}`)
                        setMidiUrl(newMidiUrl)
                        setState('completed')
                    }
                }
            )
            .subscribe()

        return () => {
            sb.removeChannel(channel)
        }
    }, [configId, log])

    // -----------------------------------------------------------------------
    // Poll job status as fallback (in case Realtime is not configured)
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (!jobId || state === 'completed' || state === 'error') return

        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/transcribe/status?jobId=${jobId}`)
                const data = await res.json()

                // Track progress updates
                if (data.progress?.percent != null) {
                    const prev = progress
                    if (!prev || prev.stage !== data.progress.stage) {
                        log(`[${data.progress.percent}%] ${data.progress.stage}`)
                    }
                    setProgress(data.progress)
                }

                if (data.state === 'completed') {
                    setProgress({ percent: 100, stage: 'Complete!' })
                    log(`[100%] Transcription complete!`)
                    if (data.returnvalue?.finalMidiUrl) {
                        setMidiUrl(data.returnvalue.finalMidiUrl)
                    }
                    setState('completed')
                    clearInterval(interval)
                } else if (data.state === 'failed') {
                    log(`Job failed: ${data.failedReason}`)
                    setError(data.failedReason || 'Transcription failed')
                    setState('error')
                    clearInterval(interval)
                } else if (data.state === 'active') {
                    setState('transcribing')
                }
            } catch {
                // polling failure is non-fatal
            }
        }, 3000)

        return () => clearInterval(interval)
    }, [jobId, state, log])

    // -----------------------------------------------------------------------
    // Upload audio to R2 via presigned URL, then queue transcription
    // -----------------------------------------------------------------------
    async function handleTranscribe() {
        if (!audioFile) return

        try {
            setError(null)
            setState('uploading')
            log(`Uploading ${audioFile.name} (${(audioFile.size / 1024 / 1024).toFixed(1)} MB)`)

            // 1. Get presigned URL
            const uploadRes = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    configId,
                    filename: audioFile.name,
                }),
            })
            const { presignedUrl, publicUrl } = await uploadRes.json()

            // 2. Upload directly to R2
            await fetch(presignedUrl, {
                method: 'PUT',
                body: audioFile,
                headers: { 'Content-Type': 'audio/wav' },
            })

            setAudioUrl(publicUrl)
            log(`Uploaded to R2: ${publicUrl}`)

            // 3. Queue transcription job
            setState('queued')
            log('Queueing transcription job...')

            const transcribeRes = await fetch('/api/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    configId,
                    audioUrl: publicUrl,
                }),
            })
            const { jobId: newJobId } = await transcribeRes.json()

            setJobId(newJobId)
            log(`Job queued: ${newJobId}`)
            setState('transcribing')
            log('GPU spinning up — transcribing audio to MIDI...')
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error'
            log(`Error: ${message}`)
            setError(message)
            setState('error')
        }
    }

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------
    const stateLabel: Record<TranscriptionState, string> = {
        idle: 'Ready',
        uploading: 'Uploading audio...',
        queued: 'Queued for transcription...',
        transcribing: 'Transcribing on GPU...',
        completed: 'Transcription complete!',
        error: 'Error',
    }

    return (
        <main className="min-h-screen bg-black text-white p-8 max-w-3xl mx-auto">
            <h1 className="text-3xl font-bold mb-2">
                Live Audio Transcription
            </h1>
            <p className="text-neutral-400 mb-8">
                Upload a piano audio file (.wav) and the ByteDance AI model will
                generate a high-accuracy MIDI transcription.
            </p>

            {/* Config ID */}
            <div className="mb-6 text-sm text-neutral-500">
                Config ID: <code className="text-neutral-300">{configId}</code>
            </div>

            {/* File Input */}
            <div className="mb-6">
                <label className="block text-sm font-medium mb-2">
                    Audio File
                </label>
                <input
                    type="file"
                    accept="audio/wav,audio/*"
                    onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-neutral-300
                        file:mr-4 file:py-2 file:px-4 file:rounded file:border-0
                        file:text-sm file:font-semibold file:bg-white file:text-black
                        hover:file:bg-neutral-200 cursor-pointer"
                    disabled={state !== 'idle' && state !== 'error'}
                />
                {audioFile && (
                    <p className="mt-2 text-sm text-neutral-400">
                        {audioFile.name} —{' '}
                        {(audioFile.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                )}
            </div>

            {/* Transcribe Button */}
            <button
                onClick={handleTranscribe}
                disabled={
                    !audioFile ||
                    (state !== 'idle' && state !== 'error')
                }
                className="px-6 py-3 bg-white text-black font-semibold rounded-lg
                    hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed
                    transition-colors mb-6"
            >
                AI Transcribe
            </button>

            {/* Status + Progress */}
            <div className="mb-6">
                <div className="flex items-center gap-3">
                    <span
                        className={`inline-block w-2.5 h-2.5 rounded-full ${
                            state === 'completed'
                                ? 'bg-green-500'
                                : state === 'error'
                                  ? 'bg-red-500'
                                  : state === 'idle'
                                    ? 'bg-neutral-600'
                                    : 'bg-yellow-500 animate-pulse'
                        }`}
                    />
                    <span className="text-sm font-medium">
                        {progress?.stage && state === 'transcribing'
                            ? `${progress.stage} (${progress.percent}%)`
                            : stateLabel[state]}
                    </span>
                </div>

                {/* Progress bar */}
                {(state === 'transcribing' || state === 'uploading' || state === 'queued') && (
                    <div className="mt-3 w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
                        <div
                            className="h-full bg-yellow-500 rounded-full transition-all duration-700 ease-out"
                            style={{ width: `${progress?.percent ?? 5}%` }}
                        />
                    </div>
                )}
                {state === 'completed' && (
                    <div className="mt-3 w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full w-full" />
                    </div>
                )}

                {error && (
                    <p className="mt-2 text-sm text-red-400">{error}</p>
                )}
            </div>

            {/* Result */}
            {midiUrl && (
                <div className="mb-6 p-4 rounded-lg bg-neutral-900 border border-neutral-800">
                    <p className="text-sm font-medium text-green-400 mb-2">
                        MIDI Generated
                    </p>
                    <a
                        href={midiUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-400 underline break-all"
                    >
                        {midiUrl}
                    </a>
                </div>
            )}

            {/* Debug Logs */}
            <div className="mt-8">
                <h2 className="text-sm font-medium text-neutral-400 mb-2">
                    Pipeline Log
                </h2>
                <div ref={logRef} className="bg-neutral-950 border border-neutral-800 rounded-lg p-4 h-64 overflow-y-auto font-mono text-xs text-neutral-300">
                    {logs.length === 0 && (
                        <span className="text-neutral-600">
                            Waiting for activity...
                        </span>
                    )}
                    {logs.map((line, i) => (
                        <div key={i}>{line}</div>
                    ))}
                </div>
            </div>
        </main>
    )
}
