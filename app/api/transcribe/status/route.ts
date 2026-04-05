import { NextRequest, NextResponse } from 'next/server'
import { getTranscriptionQueue } from '@/lib/queue'
import { wakeRailwayWorker } from '@/lib/railway'

const STALE_WAIT_MS = Number(process.env.TRANSCRIPTION_STALE_WAIT_MS || 25 * 1000)

async function wakeRailwayWorkerWithTimeout(timeoutMs: number): Promise<void> {
    await Promise.race([
        wakeRailwayWorker(),
        new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error(`Railway wake timed out after ${timeoutMs}ms`)), timeoutMs)
        }),
    ])
}

function isTransientFailure(failedReason?: string | null): boolean {
    if (!failedReason) return false
    const reason = failedReason.toLowerCase()
    return (
        reason.includes('gpu transcription failed (500') ||
        reason.includes('gpu transcription failed (502') ||
        reason.includes('gpu transcription failed (503') ||
        reason.includes('gpu transcription failed (504') ||
        reason.includes('gpu transcription request failed') ||
        reason.includes('timed out') ||
        reason.includes('econnreset') ||
        reason.includes('fetch failed')
    )
}

export async function GET(req: NextRequest) {
    try {
        const jobId = req.nextUrl.searchParams.get('jobId')

        if (!jobId) {
            return NextResponse.json(
                { error: 'jobId query param is required' },
                { status: 400 }
            )
        }

        const queue = getTranscriptionQueue()
        const job = await queue.getJob(jobId)

        if (!job) {
            return NextResponse.json(
                { error: 'Job not found' },
                { status: 404 }
            )
        }

        const state = await job.getState()

        const progress = job.progress as { percent?: number; stage?: string } | undefined
        const now = Date.now()
        const jobCreatedAt = job.timestamp || now
        const jobAgeMs = Math.max(0, now - jobCreatedAt)
        const staleWaiting = state === 'waiting' && jobAgeMs >= STALE_WAIT_MS

        let recovery: {
            staleWakeTriggered?: boolean
            staleWakeError?: string
            retriedAsJobId?: string
            retryReason?: string
            retryError?: string
        } | null = null

        if (staleWaiting) {
            recovery = { ...(recovery ?? {}), staleWakeTriggered: true }
            try {
                await wakeRailwayWorkerWithTimeout(4000)
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                recovery.staleWakeError = message
                console.warn('[transcribe/status] stale job wake failed (non-fatal):', {
                    jobId,
                    ageMs: jobAgeMs,
                    message,
                })
            }
        }

        if (state === 'failed' && isTransientFailure(job.failedReason)) {
            const retryJobId = `recover-${job.id}`
            recovery = { ...(recovery ?? {}), retryReason: 'transient_failure_detected' }
            try {
                await queue.add(
                    'transcribe-job',
                    {
                        ...job.data,
                        _recoveredFromJobId: job.id,
                    },
                    {
                        jobId: retryJobId,
                        attempts: 3,
                        backoff: { type: 'exponential', delay: 5000 },
                    }
                )

                recovery.retriedAsJobId = retryJobId
                console.log('[transcribe/status] queued recovery retry job', {
                    failedJobId: job.id,
                    retryJobId,
                })

                try {
                    await wakeRailwayWorkerWithTimeout(4000)
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error)
                    recovery.staleWakeError = message
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                if (message.toLowerCase().includes('jobid') && message.toLowerCase().includes('exists')) {
                    recovery.retriedAsJobId = retryJobId
                } else {
                    recovery.retryError = message
                    console.warn('[transcribe/status] failed to enqueue retry job', {
                        failedJobId: job.id,
                        retryJobId,
                        message,
                    })
                }
            }
        }

        return NextResponse.json({
            jobId: job.id,
            state,
            progress: progress ?? null,
            ageMs: jobAgeMs,
            staleThresholdMs: STALE_WAIT_MS,
            staleWaiting,
            recovery,
            data: job.data,
            returnvalue: job.returnvalue,
            failedReason: job.failedReason,
        })
    } catch (error) {
        console.error('[transcribe/status] Failed to get job status:', error)
        return NextResponse.json(
            { error: 'Failed to get job status' },
            { status: 500 }
        )
    }
}
