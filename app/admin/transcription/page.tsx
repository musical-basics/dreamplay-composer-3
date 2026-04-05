'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type QueueJobSummary = {
    id: string
    progress: unknown
    data: Record<string, unknown>
    failedReason?: string | null
    processedOn?: number | null
    finishedOn?: number | null
    attemptsMade?: number
    ageMs?: number
    stale?: boolean
}

type QueueDebugPayload = {
    counts: {
        waiting: number
        active: number
        failed: number
        completed: number
        delayed: number
    }
    health?: {
        staleWaitThresholdMs: number
        staleWaitingCount: number
        oldestWaitingAgeMs: number
    }
    waiting: QueueJobSummary[]
    active: QueueJobSummary[]
    failed: QueueJobSummary[]
    completed: QueueJobSummary[]
}

const POLL_INTERVAL_MS = 3000

function formatAge(ms?: number): string {
    if (ms == null) return 'n/a'
    const sec = Math.round(ms / 1000)
    if (sec < 60) return `${sec}s`
    const min = Math.floor(sec / 60)
    const rem = sec % 60
    return `${min}m ${rem}s`
}

function CountCard({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
        </div>
    )
}

function JobTable({ title, jobs }: { title: string; jobs: QueueJobSummary[] }) {
    return (
        <section className="rounded-xl border border-neutral-800 bg-neutral-950">
            <header className="border-b border-neutral-800 px-4 py-3">
                <h2 className="text-sm font-semibold text-white">{title}</h2>
            </header>
            <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead>
                        <tr className="text-left text-neutral-500">
                            <th className="px-4 py-2">Job ID</th>
                            <th className="px-4 py-2">Config</th>
                            <th className="px-4 py-2">Age</th>
                            <th className="px-4 py-2">Attempts</th>
                            <th className="px-4 py-2">Failure</th>
                        </tr>
                    </thead>
                    <tbody>
                        {jobs.length === 0 && (
                            <tr>
                                <td className="px-4 py-3 text-neutral-600" colSpan={5}>
                                    No jobs
                                </td>
                            </tr>
                        )}
                        {jobs.map((job) => (
                            <tr key={job.id} className="border-t border-neutral-900 align-top">
                                <td className="px-4 py-2 font-mono text-xs text-neutral-300">{job.id}</td>
                                <td className="px-4 py-2 text-neutral-400">
                                    <span className="font-mono text-xs">{String(job.data?.configId || 'n/a')}</span>
                                </td>
                                <td className="px-4 py-2 text-neutral-400">
                                    {formatAge(job.ageMs)}
                                    {job.stale && <span className="ml-2 rounded bg-red-500/20 px-2 py-0.5 text-[10px] uppercase text-red-300">stale</span>}
                                </td>
                                <td className="px-4 py-2 text-neutral-400">{job.attemptsMade ?? 0}</td>
                                <td className="max-w-lg truncate px-4 py-2 text-xs text-red-300" title={job.failedReason || ''}>
                                    {job.failedReason || '-'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    )
}

export default function TranscriptionOpsPage() {
    const [payload, setPayload] = useState<QueueDebugPayload | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [lastUpdated, setLastUpdated] = useState<string>('never')

    const loadQueueDebug = useCallback(async () => {
        try {
            const res = await fetch('/api/transcribe/queue-debug', { cache: 'no-store' })
            const data = await res.json()
            if (!res.ok) {
                throw new Error(data?.error || `Queue debug failed (${res.status})`)
            }
            setPayload(data)
            setError(null)
            setLastUpdated(new Date().toLocaleTimeString())
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error'
            setError(message)
        }
    }, [])

    useEffect(() => {
        loadQueueDebug()
        const interval = setInterval(loadQueueDebug, POLL_INTERVAL_MS)
        return () => clearInterval(interval)
    }, [loadQueueDebug])

    const staleSummary = useMemo(() => {
        if (!payload?.health) return 'No stale data yet'
        const threshold = Math.round(payload.health.staleWaitThresholdMs / 1000)
        return `Stale threshold: ${threshold}s • stale waiting jobs: ${payload.health.staleWaitingCount} • oldest waiting age: ${formatAge(payload.health.oldestWaitingAgeMs)}`
    }, [payload])

    return (
        <main className="min-h-screen bg-black p-6 text-white">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
                    <h1 className="text-2xl font-bold">Transcription Ops</h1>
                    <p className="mt-2 text-sm text-neutral-400">
                        Live queue telemetry for transcription jobs. Auto refreshes every {Math.round(POLL_INTERVAL_MS / 1000)} seconds.
                    </p>
                    <p className="mt-2 text-xs text-neutral-500">Last updated: {lastUpdated}</p>
                    <p className="mt-1 text-xs text-amber-300">{staleSummary}</p>
                    {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
                </header>

                {payload && (
                    <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
                        <CountCard label="Waiting" value={payload.counts.waiting} />
                        <CountCard label="Active" value={payload.counts.active} />
                        <CountCard label="Failed" value={payload.counts.failed} />
                        <CountCard label="Completed" value={payload.counts.completed} />
                        <CountCard label="Delayed" value={payload.counts.delayed} />
                    </section>
                )}

                <JobTable title="Waiting" jobs={payload?.waiting ?? []} />
                <JobTable title="Active" jobs={payload?.active ?? []} />
                <JobTable title="Recent Failed" jobs={payload?.failed ?? []} />
                <JobTable title="Recent Completed" jobs={payload?.completed ?? []} />
            </div>
        </main>
    )
}
