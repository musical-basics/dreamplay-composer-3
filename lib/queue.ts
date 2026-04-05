import { Queue } from 'bullmq'
import IORedis from 'ioredis'

let connection: IORedis | null = null

export function getRedisConnection(): IORedis {
    if (!connection) {
        connection = new IORedis(process.env.REDIS_URL!, {
            maxRetriesPerRequest: null,
        })
    }
    return connection
}

let transcriptionQueue: Queue | null = null

export function getTranscriptionQueue(): Queue {
    if (!transcriptionQueue) {
        transcriptionQueue = new Queue('transcription', {
            connection: getRedisConnection(),
        })
    }
    return transcriptionQueue
}

let videoExportQueue: Queue | null = null

export function getVideoExportQueue(): Queue {
    if (!videoExportQueue) {
        videoExportQueue = new Queue('video-export', {
            connection: getRedisConnection(),
        })
    }
    return videoExportQueue
}
