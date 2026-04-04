import { NextRequest, NextResponse } from 'next/server'
import { getTranscriptionQueue } from '@/lib/queue'

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

        return NextResponse.json({
            jobId: job.id,
            state,
            progress: progress ?? null,
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
