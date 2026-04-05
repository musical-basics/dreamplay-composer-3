import { NextResponse } from 'next/server'
import { getTranscriptionQueue } from '@/lib/queue'

const STALE_WAIT_MS = Number(process.env.TRANSCRIPTION_STALE_WAIT_MS || 25 * 1000)

/**
 * GET /api/transcribe/queue-debug
 * Temporary diagnostic endpoint — shows queue state to diagnose why Modal isn't getting called.
 */
export async function GET() {
    try {
        const queue = getTranscriptionQueue()
        const now = Date.now()

        const [waiting, active, failed, completed, delayed] = await Promise.all([
            queue.getWaiting(),
            queue.getActive(),
            queue.getFailed(),
            queue.getCompleted(),
            queue.getDelayed(),
        ])

        const waitingWithAge = waiting.map((job) => {
            const ageMs = Math.max(0, now - (job.timestamp || now))
            return { job, ageMs, stale: ageMs >= STALE_WAIT_MS }
        })

        const staleWaiting = waitingWithAge.filter((entry) => entry.stale)
        const oldestWaitingAgeMs = waitingWithAge.length > 0
            ? waitingWithAge.reduce((max, entry) => Math.max(max, entry.ageMs), 0)
            : 0

        const summarize = (jobs: any[]) =>
            jobs.map((j) => ({
                id: j.id,
                state: 'unknown',
                progress: j.progress,
                data: j.data,
                failedReason: j.failedReason,
                processedOn: j.processedOn,
                finishedOn: j.finishedOn,
                attemptsMade: j.attemptsMade,
            }))

        return NextResponse.json({
            counts: {
                waiting: waiting.length,
                active: active.length,
                failed: failed.length,
                completed: completed.length,
                delayed: delayed.length,
            },
            health: {
                staleWaitThresholdMs: STALE_WAIT_MS,
                staleWaitingCount: staleWaiting.length,
                oldestWaitingAgeMs,
            },
            waiting: waitingWithAge.map((entry) => ({
                ...summarize([entry.job])[0],
                ageMs: entry.ageMs,
                stale: entry.stale,
            })),
            active: summarize(active),
            failed: summarize(failed.slice(0, 5)), // last 5 failures
            completed: summarize(completed.slice(-3)), // last 3 completions
        })
    } catch (error) {
        console.error('[queue-debug]', error)
        return NextResponse.json({ error: String(error) }, { status: 500 })
    }
}
