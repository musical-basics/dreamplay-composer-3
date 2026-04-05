#!/usr/bin/env node

/**
 * Cleanup old job logs
 *
 * Deletes any .json files in /logs older than 7 days.
 * Can be run as:
 *   - npx tsx scripts/cleanupLogs.ts
 *   - node scripts/cleanupLogs.cjs (after build)
 *   - Scheduled as a cron job: 0 2 * * * cd /path && npx tsx scripts/cleanupLogs.ts
 */

import { promises as fs } from 'fs'
import { resolve } from 'path'

const RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS || '7')
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000
const logsDir = resolve(process.cwd(), 'logs')

async function cleanupLogs(): Promise<void> {
  const now = Date.now()
  let deletedCount = 0
  let errorCount = 0

  try {
    const files = await fs.readdir(logsDir, { withFileTypes: true })

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.json')) {
        continue
      }

      try {
        const filepath = resolve(logsDir, file.name)
        const stat = await fs.stat(filepath)
        const ageMs = now - stat.mtimeMs

        if (ageMs > RETENTION_MS) {
          await fs.unlink(filepath)
          deletedCount++
          console.log(`[cleanup] Deleted: ${file.name} (age: ${Math.round(ageMs / 1000 / 60 / 60)}h)`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[cleanup] Failed to process ${file.name}: ${message}`)
        errorCount++
      }
    }

    console.log(
      `[cleanup] Complete — deleted ${deletedCount} file(s), ${errorCount} error(s), retention: ${RETENTION_DAYS}d`
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('[cleanup] No logs directory found; skipping cleanup')
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    console.error(`[cleanup] Failed to cleanup logs: ${message}`)
    process.exit(1)
  }
}

cleanupLogs().catch((error) => {
  console.error('[cleanup] Fatal error:', error)
  process.exit(1)
})
