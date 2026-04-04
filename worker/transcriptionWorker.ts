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

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------
const worker = new Worker(
    'transcription',
    async (job) => {
        const { configId, audioUrl } = job.data
        console.log(`[transcription] Job ${job.id} started — configId=${configId}`)

        // 1. Call Modal GPU endpoint
        console.log(`[transcription] Calling Modal GPU at ${MODAL_URL}`)
        const modalResponse = await fetch(MODAL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio_url: audioUrl }),
        })

        if (!modalResponse.ok) {
            const errorText = await modalResponse.text()
            throw new Error(
                `GPU transcription failed (${modalResponse.status}): ${errorText}`
            )
        }

        // 2. Receive raw MIDI binary from response
        const midiArrayBuffer = await modalResponse.arrayBuffer()
        const midiBuffer = Buffer.from(midiArrayBuffer)
        console.log(
            `[transcription] Received MIDI: ${midiBuffer.length} bytes`
        )

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
