import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { promises as fs } from 'fs'

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
const TRANSCRIPTION_DEBUG_MODE = process.env.TRANSCRIPTION_DEBUG_MODE !== 'false'
const TRANSCRIPTION_DEBUG_UPLOAD_TO_R2 = process.env.TRANSCRIPTION_DEBUG_UPLOAD_TO_R2 === 'true'
const LOCAL_DEBUG_DIR = resolve(__dirname, '..', 'debug-artifacts', 'transcription')

type DebugLevel = 'info' | 'warn' | 'error'

type DebugEvent = {
    at: string
    elapsedMs: number
    level: DebugLevel
    step: string
    message: string
    data?: Record<string, unknown>
}

type DebugArtifact = {
    kind: 'transcription-job-debug'
    version: 1
    jobId: string
    queue: 'transcription'
    configId: string
    audioUrl: string
    audioSource: string
    modalUrl: string
    startedAt: string
    finishedAt: string
    totalMs: number
    status: 'completed' | 'failed'
    timings: {
        modalMs?: number
        r2UploadMs?: number
        supabaseUpdateMs?: number
    }
    output: {
        midiKey?: string
        finalMidiUrl?: string
    }
    error?: {
        message: string
    }
    events: DebugEvent[]
}

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
        const jobStartedAt = Date.now()
        const events: DebugEvent[] = []
        const timings: DebugArtifact['timings'] = {}
        let finalMidiUrl: string | undefined
        let midiKey: string | undefined
        let caughtError: Error | null = null
        let debugArtifactLocalPath: string | undefined
        let debugArtifactR2Url: string | undefined

        const logEvent = (
            level: DebugLevel,
            step: string,
            message: string,
            data?: Record<string, unknown>
        ) => {
            const elapsedMs = Date.now() - jobStartedAt
            events.push({
                at: new Date().toISOString(),
                elapsedMs,
                level,
                step,
                message,
                data,
            })

            const printableData = data ? ` ${JSON.stringify(data)}` : ''
            const line = `[transcription] [job:${job.id}] [${step}] ${message}${printableData}`
            if (level === 'error') console.error(line)
            else if (level === 'warn') console.warn(line)
            else console.log(line)
        }

        logEvent('info', 'start', `Job started — configId=${configId}`)
        logEvent('info', 'start', 'Audio source resolved', { audioSource: redactUrlForLogs(audioUrl) })

        await job.updateProgress({ percent: 5, stage: 'Connecting to GPU...' })

        try {
            // 1. Call Modal GPU endpoint
            logEvent('info', 'modal', `Calling Modal GPU at ${MODAL_URL}`)
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
            timings.modalMs = modalElapsedMs
            const modalCallId = modalResponse.headers.get('modal-function-call-id') || 'n/a'
            const modalContentType = modalResponse.headers.get('content-type') || 'unknown'
            const modalContentLength = modalResponse.headers.get('content-length') || 'unknown'

            logEvent('info', 'modal', 'Modal response received', {
                status: modalResponse.status,
                elapsedMs: modalElapsedMs,
                callId: modalCallId,
                contentType: modalContentType,
                contentLength: modalContentLength,
            })

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

            logEvent('info', 'modal', 'Received MIDI payload', {
                bytes: midiBuffer.length,
                callId: modalCallId,
            })

            await job.updateProgress({ percent: 80, stage: 'Uploading MIDI to storage...' })

            // 3. Upload MIDI to R2
            midiKey = `midi/${configId}-ai-transcription-${Date.now()}.mid`
            const r2UploadStartedAt = Date.now()
            await s3.send(
                new PutObjectCommand({
                    Bucket: process.env.R2_BUCKET_NAME!,
                    Key: midiKey,
                    Body: midiBuffer,
                    ContentType: 'audio/midi',
                })
            )
            timings.r2UploadMs = Date.now() - r2UploadStartedAt

            finalMidiUrl = getR2PublicUrl(midiKey)
            logEvent('info', 'r2', 'Uploaded MIDI to R2', {
                midiKey,
                finalMidiUrl,
                elapsedMs: timings.r2UploadMs,
            })

            await job.updateProgress({ percent: 90, stage: 'Updating database...' })

            // 4. Update Supabase (composer.configurations)
            const supabaseUpdateStartedAt = Date.now()
            const { error } = await supabase
                .from('configurations')
                .update({ midi_url: finalMidiUrl, updated_at: new Date().toISOString() })
                .eq('id', configId)
            timings.supabaseUpdateMs = Date.now() - supabaseUpdateStartedAt

            if (error) {
                throw new Error(
                    `Supabase update failed: ${error.message}`
                )
            }

            await job.updateProgress({ percent: 100, stage: 'Complete!' })

            logEvent('info', 'complete', 'Job completed — midi_url written to DB', {
                finalMidiUrl,
                totalMs: Date.now() - jobStartedAt,
            })
        } catch (error) {
            caughtError = error instanceof Error ? error : new Error(String(error))
            logEvent('error', 'failure', 'Job failed', {
                message: caughtError.message,
            })
        } finally {
            if (TRANSCRIPTION_DEBUG_MODE) {
                const now = Date.now()
                const artifact: DebugArtifact = {
                    kind: 'transcription-job-debug',
                    version: 1,
                    jobId: String(job.id),
                    queue: 'transcription',
                    configId: String(configId),
                    audioUrl: String(audioUrl),
                    audioSource: redactUrlForLogs(String(audioUrl)),
                    modalUrl: MODAL_URL,
                    startedAt: new Date(jobStartedAt).toISOString(),
                    finishedAt: new Date(now).toISOString(),
                    totalMs: now - jobStartedAt,
                    status: caughtError ? 'failed' : 'completed',
                    timings,
                    output: {
                        midiKey,
                        finalMidiUrl,
                    },
                    error: caughtError ? { message: caughtError.message } : undefined,
                    events,
                }

                try {
                    await fs.mkdir(LOCAL_DEBUG_DIR, { recursive: true })
                    const artifactName = `${job.id}-${Date.now()}.json`
                    debugArtifactLocalPath = resolve(LOCAL_DEBUG_DIR, artifactName)
                    await fs.writeFile(debugArtifactLocalPath, JSON.stringify(artifact, null, 2), 'utf8')
                    console.log(`[transcription] Debug artifact written: ${debugArtifactLocalPath}`)

                    if (TRANSCRIPTION_DEBUG_UPLOAD_TO_R2) {
                        const debugKey = `debug/transcription/${artifactName}`
                        await s3.send(
                            new PutObjectCommand({
                                Bucket: process.env.R2_BUCKET_NAME!,
                                Key: debugKey,
                                Body: Buffer.from(JSON.stringify(artifact, null, 2), 'utf8'),
                                ContentType: 'application/json',
                            })
                        )
                        debugArtifactR2Url = getR2PublicUrl(debugKey)
                        console.log(`[transcription] Debug artifact uploaded: ${debugArtifactR2Url}`)
                    }
                } catch (artifactError) {
                    const message = artifactError instanceof Error ? artifactError.message : String(artifactError)
                    console.warn(`[transcription] Failed to persist debug artifact: ${message}`)
                }
            }
        }

        if (caughtError) {
            throw caughtError
        }

        return {
            finalMidiUrl,
            debugArtifactLocalPath,
            debugArtifactR2Url,
        }
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
