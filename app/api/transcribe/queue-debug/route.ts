import { NextResponse } from 'next/server'
import { getTranscriptionQueue } from '@/lib/queue'

/**
 * GET /api/transcribe/queue-debug
 * Temporary diagnostic endpoint — shows queue state to diagnose why Modal isn't getting called.
 */
export async function GET() {
    try {
        const queue = getTranscriptionQueue()

        const [waiting, active, failed, completed, delayed] = await Promise.all([
            queue.getWaiting(),
            queue.getActive(),
            queue.getFailed(),
            queue.getCompleted(),
            queue.getDelayed(),
        ])

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
            waiting: summarize(waiting),
            active: summarize(active),
            failed: summarize(failed.slice(0, 5)), // last 5 failures
            completed: summarize(completed.slice(-3)), // last 3 completions
        })
    } catch (error) {
        console.error('[queue-debug]', error)
        return NextResponse.json({ error: String(error) }, { status: 500 })
    }
}
