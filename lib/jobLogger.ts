/**
 * Unified Job Logging System
 *
 * Every job/task in the app calls logJobResult() at completion.
 * Writes structured JSON logs to /logs directory.
 * JSON files are named: {timestamp}_{job_name}.json
 */

import { promises as fs } from 'fs'
import { resolve } from 'path'

export interface JobLogPayload {
  job_name: string
  status: 'success' | 'error'
  timestamp: string
  duration_ms: number
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  error: {
    message: string
    stack?: string
  } | null
}

/**
 * Log the result of a completed or failed job.
 * Creates /logs directory if it doesn't exist.
 * Writes JSON file (non-blocking, errors logged to console).
 */
export async function logJobResult(payload: JobLogPayload): Promise<void> {
  try {
    const logsDir = resolve(process.cwd(), 'logs')
    await fs.mkdir(logsDir, { recursive: true })

    // Filename: {ISO timestamp with ms}_{job_name}.json
    const isoTimestamp = payload.timestamp.replace(/[:.]/g, '-')
    const filename = `${isoTimestamp}_${payload.job_name}.json`
    const filepath = resolve(logsDir, filename)

    await fs.writeFile(filepath, JSON.stringify(payload, null, 2), 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[jobLogger] Failed to write job log: ${message}`)
  }
}

/**
 * Create a job log payload with automatic timestamps and duration handling.
 * Call this at the end of any job/task.
 */
export function createJobLog(
  jobName: string,
  startMs: number,
  input: Record<string, unknown>,
  output: Record<string, unknown> | null,
  error: Error | null
): JobLogPayload {
  const now = Date.now()
  const errorPayload = error
    ? {
        message: error.message,
        stack: error.stack,
      }
    : null

  return {
    job_name: jobName,
    status: error ? 'error' : 'success',
    timestamp: new Date().toISOString(),
    duration_ms: now - startMs,
    input,
    output,
    error: errorPayload,
  }
}
