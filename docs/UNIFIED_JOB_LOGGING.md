# Unified Job Logging System

## Overview

All background jobs in DreamPlay Composer now use a unified JSON logging system. This provides:
- Structured, queryable job logs in `/logs/{timestamp}_{job_name}.json`
- Consistent format across different job types (transcription, video export, etc.)
- Automatic duration calculation and error capture
- Non-blocking logging (failures don't affect job completion)

## Architecture

### Entry Point: `/lib/jobLogger.ts`

Two utility functions:

```typescript
// Log any job result with auto-structuring
export async function logJobResult(payload: JobLogPayload): Promise<void>

// Create structured payload with auto-timestamps and duration
export function createJobLog(
  jobName: string,
  startMs: number,
  input: Record<string, unknown>,
  output: Record<string, unknown> | null,
  error: Error | null
): JobLogPayload
```

### Usage Pattern

All jobs follow this same pattern:

```typescript
const startMs = Date.now()
try {
  const output = await doWork(input)
  await logJobResult(createJobLog('job-name', startMs, input, output, null))
} catch (error) {
  await logJobResult(createJobLog('job-name', startMs, input, null, error))
}
```

## Implemented Jobs

### ✅ Transcription Worker (`worker/transcriptionWorker.ts`)

- **Job Name**: `transcription`
- **Input**: `{ configId: string, audioUrl: string }`
- **Output** (success): `{ finalMidiUrl: string, debugArtifactLocalPath?: string, debugArtifactR2Url?: string }`
- **Output** (failure): `null` + `error`
- **Implementation**: Wrapped in `processTranscriptionJob()`, logs in finally block

### ⏳ Video Export Worker (NOT YET IMPLEMENTED)

The video export worker is not yet implemented. When added:
- **Job Name**: `video-export`
- **Input**: `RenderJobPayload` with exportId, configId, duration, quality, etc.
- **Output** (success): `{ finalVideoUrl: string, ... }`
- **Output** (failure): `null` + `error`

## Log Format

Each job produces a JSON file at `/logs/{ISO_TIMESTAMP}_{jobName}.json`:

```json
{
  "job_name": "transcription",
  "status": "completed",
  "timestamp": "2025-01-15T14:23:45.123Z",
  "duration_ms": 42500,
  "input": {
    "configId": "cfg_123",
    "audioUrl": "https://..."
  },
  "output": {
    "finalMidiUrl": "https://r2.../midi/cfg_123-...mid"
  },
  "error": null
}
```

On failure:

```json
{
  "job_name": "transcription",
  "status": "failed",
  "timestamp": "2025-01-15T14:23:45.123Z",
  "duration_ms": 8500,
  "input": { ... },
  "output": null,
  "error": {
    "message": "GPU transcription failed (status=500, callId=abc123): ..."
  }
}
```

## Configuration

### Environment Variables

- `LOG_RETENTION_DAYS` (optional, default: 7)
  - Used by cleanup script to delete logs older than N days

### .gitignore

`/logs` directory is excluded to prevent job logs from being committed.

## Maintenance

### Cleanup Old Logs

Run the cleanup script to delete logs older than the retention period:

```bash
npx tsx scripts/cleanupLogs.ts
```

Or with custom retention:

```bash
LOG_RETENTION_DAYS=14 npx tsx scripts/cleanupLogs.ts
```

### Scheduling Cleanup (Cron)

Add to your deployment's cron jobs:

```cron
0 2 * * * cd /app && npx tsx scripts/cleanupLogs.ts
```

This runs cleanup at 2 AM daily.

## Querying Logs

### List recent jobs

```bash
ls -lht logs/ | head -20
```

### Find job by nameish (e.g., all transcription jobs)

```bash
ls logs/ | grep transcription
```

### Parse JSON for specific info (requires `jq`):

```bash
# Find all failed jobs
jq '.[] | select(.status == "failed")' logs/*.json

# Find jobs that took > 60 seconds
jq '.[] | select(.duration_ms > 60000)' logs/*.json

# Extract all durations
jq '.duration_ms' logs/*.json
```

## Adding New Jobs

1. Wrap with try-catch-finally in the job handler
2. Import at top: `import { logJobResult, createJobLog } from '@/lib/jobLogger'`
3. Capture `startMs = Date.now()` before work begins
4. Call `logJobResult(createJobLog('job-type', startMs, input, output, error))` in finally block
5. No other changes needed

Example for a hypothetical "email-send" job:

```typescript
async function processEmailJob(job: Job) {
  const startMs = Date.now()
  const { email, subject, body } = job.data
  
  let output = null
  let error = null
  
  try {
    const result = await sendEmail({ email, subject, body })
    output = { messageId: result.id, sentAt: result.timestamp }
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err))
  } finally {
    await logJobResult(createJobLog('email-send', startMs, job.data, output, error))
  }
  
  if (error) throw error
  return output
}
```

## Non-Blocking Logging

Job logging failures are caught and logged to console as warnings. They do NOT:
- Cause the job to fail
- Block job completion
- Prevent subsequent logging attempts

This ensures the logging system is robust and doesn't impact production workloads.

## Migration Guide

For existing job handlers without logging:

1. **Before** - job has inline try-catch:

```typescript
async (job) => {
  try {
    // ...work...
  } catch (error) {
    throw error
  }
}
```

2. **After** - wrap with logging:

```typescript
async (job) => {
  const startMs = Date.now()
  let output = null
  let error = null
  
  try {
    // ...work...
    output = { /* result */ }
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err))
  } finally {
    await logJobResult(createJobLog('job-name', startMs, job.data, output, error))
  }
  
  if (error) throw error
  return output
}
```

## Troubleshooting

### Logs not appearing

1. Check `/logs` directory exists and is writable: `ls -la logs/`
2. Check console for any `[jobLogger]` warnings
3. Verify `TRANSCRIPTION_DEBUG_MODE` is not set to `false` (it's on by default)

### Logs taking too long to write

- File I/O is async and non-blocking; shouldn't affect job times
- If slow, check disk I/O: `iostat -x 1 5`

### Need to disable logging temporarily

Set env var to disable (but keep the code):

```bash
TRANSCRIPTION_DEBUG_MODE=false npm run dev
```

This keeps the try-catch but skips all file writes, allowing you to verify if logging code is the issue.
