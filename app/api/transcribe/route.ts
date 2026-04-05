import { NextRequest, NextResponse } from 'next/server'
import { getTranscriptionQueue } from '@/lib/queue'
import { wakeRailwayWorker } from '@/lib/railway'

async function wakeRailwayWorkerWithTimeout(timeoutMs: number): Promise<void> {
    await Promise.race([
        wakeRailwayWorker(),
        new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error(`Railway wake timed out after ${timeoutMs}ms`)), timeoutMs)
        }),
    ])
}

export async function POST(req: NextRequest) {
    try {
        const { configId, audioUrl } = await req.json()

        if (!configId || !audioUrl) {
            return NextResponse.json(
                { error: 'configId and audioUrl are required' },
                { status: 400 }
            )
        }

        const queue = getTranscriptionQueue()

        const job = await queue.add('transcribe-job', {
            configId,
            audioUrl,
        }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
        })

        console.log(`[transcribe/route] Job queued: jobId=${job.id}, configId=${configId}`)

        // Wake the Railway worker (non-fatal if transcription worker isn't on Railway).
        // Await with a short timeout so serverless runtimes don't drop this fire-and-forget call.
        try {
            await wakeRailwayWorkerWithTimeout(4000)
        } catch (err) {
            console.warn('[transcribe/route] Railway wake failed (non-fatal):', err)
        }

        return NextResponse.json({
            success: true,
            jobId: job.id,
            message: 'Queued for transcription',
        })
    } catch (error) {
        console.error('[transcribe/route] Failed to queue job:', error)
        return NextResponse.json(
            { error: 'Failed to queue transcription job' },
            { status: 500 }
        )
    }
}
