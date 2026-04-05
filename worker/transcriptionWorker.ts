import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

config({ path: resolve(__dirname, '..', '.env.local') })

/**
 * BullMQ Transcription Worker
 *
 * Orchestrates the full pipeline:
 *   1. Calls Modal serverless GPU to transcribe audio → MIDI
 *   2. Uploads the resulting MIDI to Cloudflare R2
 *   3. Updates the Supabase song_configs row with the new midi_url
 *
 * Run standalone:  npx tsx worker/transcriptionWorker.ts
 */
import { Worker } from 'bullmq'
import IORedis from 'ioredis'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { createClient } from '@supabase/supabase-js'
import { createR2Client, getR2PublicUrl } from '../lib/r2'

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------
const connection = new IORedis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
})

const s3 = createR2Client()

const supabase = createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'composer' } }
)

const MODAL_URL = process.env.MODAL_TRANSCRIBER_URL!

function redactUrlForLogs(url: string): string {
    try {
        const parsed = new URL(url)
        return `${parsed.origin}${parsed.pathname}`
    } catch {
        return url
    }
}

function truncate(text: string, max = 400): string {
    if (text.length <= max) return text
    return `${text.slice(0, max)}...`
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------
const worker = new Worker(
    'transcription',
    async (job) => {
        const { configId, audioUrl } = job.data
        console.log(`[transcription] Job ${job.id} started — configId=${configId}`)
        console.log(`[transcription] Audio source: ${redactUrlForLogs(audioUrl)}`)

        await job.updateProgress({ percent: 5, stage: 'Connecting to GPU...' })

        // 1. Call Modal GPU endpoint
        console.log(`[transcription] Calling Modal GPU at ${MODAL_URL}`)
        await job.updateProgress({ percent: 10, stage: 'GPU spinning up — downloading audio...' })

        const modalRequestStartedAt = Date.now()
        let modalResponse: Response

        try {
            modalResponse = await fetch(MODAL_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audio_url: audioUrl }),
            })
        } catch (error) {
            const elapsedMs = Date.now() - modalRequestStartedAt
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`GPU transcription request failed after ${elapsedMs}ms: ${message}`)
        }

        const modalElapsedMs = Date.now() - modalRequestStartedAt
        const modalCallId = modalResponse.headers.get('modal-function-call-id') || 'n/a'
        const modalContentType = modalResponse.headers.get('content-type') || 'unknown'
        const modalContentLength = modalResponse.headers.get('content-length') || 'unknown'

        console.log(
            `[transcription] Modal response: status=${modalResponse.status} elapsedMs=${modalElapsedMs} callId=${modalCallId} contentType=${modalContentType} contentLength=${modalContentLength}`
        )

        if (!modalResponse.ok) {
            const errorText = await modalResponse.text()
            throw new Error(
                `GPU transcription failed (status=${modalResponse.status}, callId=${modalCallId}, elapsedMs=${modalElapsedMs}): ${truncate(errorText)}`
            )
        }

        await job.updateProgress({ percent: 70, stage: 'MIDI generated — downloading from GPU...' })

        // 2. Receive raw MIDI binary from response
        const midiArrayBuffer = await modalResponse.arrayBuffer()
        const midiBuffer = Buffer.from(midiArrayBuffer)

        if (midiBuffer.length === 0) {
            throw new Error(`GPU transcription returned empty MIDI payload (callId=${modalCallId})`)
        }

        console.log(
            `[transcription] Received MIDI: ${midiBuffer.length} bytes (callId=${modalCallId})`
        )

        await job.updateProgress({ percent: 80, stage: 'Uploading MIDI to storage...' })

        // 3. Upload MIDI to R2
        const midiKey = `midi/${configId}-ai-transcription-${Date.now()}.mid`
        await s3.send(
            new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME!,
                Key: midiKey,
                Body: midiBuffer,
                ContentType: 'audio/midi',
            })
        )

        const finalMidiUrl = getR2PublicUrl(midiKey)
        console.log(`[transcription] Uploaded MIDI to ${finalMidiUrl}`)

        await job.updateProgress({ percent: 90, stage: 'Updating database...' })

        // 4. Update Supabase (composer.configurations)
        const { error } = await supabase
            .from('configurations')
            .update({ midi_url: finalMidiUrl, updated_at: new Date().toISOString() })
            .eq('id', configId)

        if (error) {
            throw new Error(
                `Supabase update failed: ${error.message}`
            )
        }

        await job.updateProgress({ percent: 100, stage: 'Complete!' })

        console.log(
            `[transcription] Job ${job.id} completed — midi_url written to DB`
        )
        return { finalMidiUrl }
    },
    {
        connection,
        concurrency: 2,
    }
)

// ---------------------------------------------------------------------------
// Lifecycle logging
// ---------------------------------------------------------------------------
worker.on('completed', (job) => {
    console.log(`[transcription] Job ${job.id} completed`)
})

worker.on('failed', (job, err) => {
    console.error(`[transcription] Job ${job?.id} failed:`, err.message)
})

worker.on('ready', () => {
    console.log('[transcription] Worker ready — listening for jobs')
})

console.log('[transcription] Starting worker...')
