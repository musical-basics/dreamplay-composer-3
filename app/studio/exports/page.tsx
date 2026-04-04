'use client'

import * as React from 'react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowLeft, Download, ExternalLink, Film, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fetchMyExports } from '@/app/actions/export'
import type { VideoExportListRow } from '@/lib/types/renderJob'

function formatDateTime(value: string) {
  try {
    return new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return value
  }
}

function StatusPill({ status }: { status: VideoExportListRow['status'] }) {
  const classes =
    status === 'completed'
      ? 'bg-green-900/40 text-green-300 border-green-700/50'
      : status === 'failed'
        ? 'bg-red-900/40 text-red-300 border-red-700/50'
        : status === 'processing'
          ? 'bg-blue-900/40 text-blue-300 border-blue-700/50'
          : 'bg-zinc-800 text-zinc-300 border-zinc-700'

  return (
    <span className={`px-2 py-0.5 text-[11px] rounded-full border ${classes}`}>
      {status}
    </span>
  )
}

export default function StudioExportsPage() {
  const [rows, setRows] = useState<VideoExportListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchMyExports()
      setRows(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exports')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 bg-zinc-900/50 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/studio">
              <Button variant="ghost" size="sm" className="text-zinc-300 hover:text-white">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            </Link>
            <div>
              <h1 className="text-lg font-semibold">Exports</h1>
              <p className="text-xs text-zinc-400">Background render jobs and downloads</p>
            </div>
          </div>

          <Button variant="outline" size="sm" className="border-zinc-700 text-black hover:text-black" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        {loading ? (
          <div className="py-20 text-center text-zinc-400">Loading exports...</div>
        ) : error ? (
          <div className="py-20 text-center text-red-400">{error}</div>
        ) : rows.length === 0 ? (
          <div className="py-20 text-center text-zinc-400">No exports yet.</div>
        ) : (
          <div className="rounded-xl border border-zinc-800 overflow-hidden">
            <div className="grid grid-cols-[1.4fr_120px_120px_180px_210px] gap-3 px-4 py-2 text-[11px] uppercase tracking-wider text-zinc-500 bg-zinc-900/60 border-b border-zinc-800">
              <span>Configuration</span>
              <span>Status</span>
              <span>Progress</span>
              <span>Created</span>
              <span className="text-right">Actions</span>
            </div>

            {rows.map((row) => (
              <div key={row.id} className="grid grid-cols-[1.4fr_120px_120px_180px_210px] gap-3 items-center px-4 py-3 border-b border-zinc-900 last:border-b-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.config_title || 'Untitled'}</p>
                  <p className="truncate text-[11px] text-zinc-500 font-mono">{row.id}</p>
                </div>

                <StatusPill status={row.status} />

                <span className="text-sm text-zinc-300">{row.progress}%</span>

                <span className="text-xs text-zinc-400">{formatDateTime(row.created_at)}</span>

                <div className="flex items-center justify-end gap-2">
                  <Link href={`/studio/edit/${row.config_id}`}>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-zinc-300 hover:text-white">
                      <Film className="w-3.5 h-3.5 mr-1" /> Open
                    </Button>
                  </Link>

                  {row.mp4_url && (
                    <a href={row.mp4_url} target="_blank" rel="noreferrer">
                      <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white">
                        <Download className="w-3.5 h-3.5 mr-1" /> Download
                      </Button>
                    </a>
                  )}

                  {row.mp4_url && (
                    <a href={row.mp4_url} target="_blank" rel="noreferrer" className="text-zinc-400 hover:text-white" title="Open output URL">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
