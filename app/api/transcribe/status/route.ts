import { NextRequest, NextResponse } from 'next/server'
import { getTranscriptionQueue } from '@/lib/queue'

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

        let recovery: {
            retriedAsJobId?: string
            retryReason?: string
            retryError?: string
        } | null = null

        // Auto-retry on transient GPU failures (5xx, connection resets, timeouts)
        if (state === 'failed' && isTransientFailure(job.failedReason)) {
            const retryJobId = `recover-${job.id}`
            recovery = { retryReason: 'transient_failure_detected' }
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
