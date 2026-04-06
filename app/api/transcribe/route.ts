import { NextRequest, NextResponse } from 'next/server'
import { getTranscriptionQueue } from '@/lib/queue'

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
