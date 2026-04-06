'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { RefreshCw, User, Music, Eye, LogIn, Filter, ChevronLeft, ChevronRight } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type EventType = 'user.login' | 'config.created' | 'config.opened' | 'config.viewed'

interface ActivityLog {
    id: number
    event_type: EventType
    user_id: string | null
    config_id: string | null
    metadata: Record<string, unknown>
    created_at: string
}

interface LogsResponse {
    logs: ActivityLog[]
    userMap: Record<string, { displayName: string; email: string }>
    configMap: Record<string, string>
    total: number
}

// ─── Event config ─────────────────────────────────────────────────────────────

const EVENT_CONFIG: Record<EventType, { label: string; color: string; icon: React.ReactNode }> = {
    'user.login':      { label: 'Login',        color: 'bg-blue-500/15 text-blue-300 border-blue-500/30',    icon: <LogIn className="w-3 h-3" /> },
    'config.created':  { label: 'Created',      color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: <Music className="w-3 h-3" /> },
    'config.opened':   { label: 'Edited',       color: 'bg-amber-500/15 text-amber-300 border-amber-500/30', icon: <Music className="w-3 h-3" /> },
    'config.viewed':   { label: 'Viewed',       color: 'bg-purple-500/15 text-purple-300 border-purple-500/30', icon: <Eye className="w-3 h-3" /> },
}

const ALL_EVENT_TYPES = Object.keys(EVENT_CONFIG) as EventType[]
const PAGE_SIZE = 100

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
}

function formatFull(dateStr: string): string {
    return new Date(dateStr).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
    })
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminLogsPage() {
    const [data, setData] = useState<LogsResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [eventFilter, setEventFilter] = useState<EventType | ''>('')
    const [page, setPage] = useState(0)
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

    async function fetchLogs(opts: { filter?: EventType | '', pg?: number, silent?: boolean } = {}) {
        const filter = opts.filter ?? eventFilter
        const pg = opts.pg ?? page
        if (!opts.silent) setLoading(true)
        else setRefreshing(true)

        try {
            const params = new URLSearchParams({
                limit: String(PAGE_SIZE),
                offset: String(pg * PAGE_SIZE),
            })
            if (filter) params.set('event_type', filter)

            const res = await fetch(`/api/admin/activity-logs?${params}`)
            if (res.ok) setData(await res.json())
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }

    useEffect(() => {
        fetchLogs()
        // Auto-refresh every 30s
        intervalRef.current = setInterval(() => fetchLogs({ silent: true }), 30000)
        return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleFilterChange = (f: EventType | '') => {
        setEventFilter(f)
        setPage(0)
        fetchLogs({ filter: f, pg: 0 })
    }

    const handlePage = (p: number) => {
        setPage(p)
        fetchLogs({ pg: p })
    }

    // Summary counts
    const counts = data?.logs.reduce<Record<string, number>>((acc, l) => {
        acc[l.event_type] = (acc[l.event_type] ?? 0) + 1
        return acc
    }, {}) ?? {}

    return (
        <main className="min-h-screen bg-black text-white p-6">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">Activity Logs</h1>
                        <p className="text-sm text-zinc-500 mt-0.5">
                            {data ? `${data.total.toLocaleString()} total events` : 'Loading…'}
                            {data && <span className="ml-2 text-zinc-700">· auto-refreshes every 30s</span>}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <Link
                            href="/admin"
                            className="text-xs text-zinc-500 hover:text-white transition-colors px-3 py-1.5 border border-zinc-800 rounded-lg"
                        >
                            ← Admin
                        </Link>
                        <button
                            onClick={() => fetchLogs({ silent: true })}
                            disabled={refreshing}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 text-xs text-zinc-400 hover:text-white hover:border-zinc-500 transition-all"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                            Refresh
                        </button>
                    </div>
                </div>

                {/* Summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {ALL_EVENT_TYPES.map(et => {
                        const cfg = EVENT_CONFIG[et]
                        return (
                            <button
                                key={et}
                                onClick={() => handleFilterChange(eventFilter === et ? '' : et)}
                                className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                                    eventFilter === et
                                        ? `${cfg.color} border-current`
                                        : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-600'
                                }`}
                            >
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${cfg.color}`}>
                                    {cfg.icon}
                                </div>
                                <div className="text-left">
                                    <p className="text-xs text-zinc-500">{cfg.label}</p>
                                    <p className="text-lg font-bold text-white leading-none mt-0.5">
                                        {data ? (counts[et] ?? 0).toLocaleString() : '–'}
                                    </p>
                                </div>
                            </button>
                        )
                    })}
                </div>

                {/* Filter bar */}
                <div className="flex items-center gap-2">
                    <Filter className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                    <button
                        onClick={() => handleFilterChange('')}
                        className={`px-3 py-1 text-xs rounded-full border transition-all ${
                            eventFilter === '' ? 'bg-zinc-700 text-white border-zinc-600' : 'text-zinc-500 border-zinc-800 hover:text-zinc-300'
                        }`}
                    >
                        All
                    </button>
                    {ALL_EVENT_TYPES.map(et => (
                        <button
                            key={et}
                            onClick={() => handleFilterChange(et)}
                            className={`flex items-center gap-1 px-3 py-1 text-xs rounded-full border transition-all ${
                                eventFilter === et
                                    ? `${EVENT_CONFIG[et].color}`
                                    : 'text-zinc-500 border-zinc-800 hover:text-zinc-300'
                            }`}
                        >
                            {EVENT_CONFIG[et].icon}
                            {EVENT_CONFIG[et].label}
                        </button>
                    ))}
                </div>

                {/* Table */}
                <div className="rounded-xl border border-zinc-800 overflow-hidden">
                    {/* Table header */}
                    <div className="grid grid-cols-[140px_1fr_1fr_1fr_120px] gap-4 px-4 py-2 bg-zinc-900/80 border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                        <span>Event</span>
                        <span>User</span>
                        <span>Composition</span>
                        <span>Details</span>
                        <span className="text-right">Time</span>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-20 text-zinc-600 text-sm">
                            Loading logs…
                        </div>
                    ) : !data?.logs.length ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3">
                            <div className="w-12 h-12 rounded-xl bg-zinc-800/50 flex items-center justify-center">
                                <Eye className="w-6 h-6 text-zinc-600" />
                            </div>
                            <p className="text-zinc-500 text-sm">No activity logs yet</p>
                            <p className="text-zinc-700 text-xs">Events will appear here once users start interacting</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-zinc-800/50">
                            {data.logs.map(log => {
                                const cfg = EVENT_CONFIG[log.event_type] ?? EVENT_CONFIG['config.viewed']
                                const user = log.user_id ? data.userMap[log.user_id] : null
                                const configTitle = log.config_id ? data.configMap[log.config_id] : null

                                return (
                                    <div
                                        key={log.id}
                                        className="grid grid-cols-[140px_1fr_1fr_1fr_120px] gap-4 items-center px-4 py-3 hover:bg-zinc-900/40 transition-colors"
                                    >
                                        {/* Event badge */}
                                        <div>
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${cfg.color}`}>
                                                {cfg.icon}
                                                {cfg.label}
                                            </span>
                                        </div>

                                        {/* User */}
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center shrink-0">
                                                <User className="w-3 h-3 text-zinc-400" />
                                            </div>
                                            <div className="min-w-0">
                                                {user ? (
                                                    <>
                                                        <p className="text-xs text-white truncate font-medium">{user.displayName}</p>
                                                        <p className="text-[10px] text-zinc-600 truncate">{user.email}</p>
                                                    </>
                                                ) : (
                                                    <p className="text-xs text-zinc-600">Anonymous</p>
                                                )}
                                            </div>
                                        </div>

                                        {/* Config */}
                                        <div className="min-w-0">
                                            {log.config_id && configTitle ? (
                                                <Link
                                                    href={`/admin/view/${log.config_id}`}
                                                    className="text-xs text-purple-300 hover:text-purple-200 truncate block transition-colors"
                                                >
                                                    {configTitle}
                                                </Link>
                                            ) : (
                                                <span className="text-xs text-zinc-700">—</span>
                                            )}
                                            {log.config_id && (
                                                <p className="text-[10px] text-zinc-700 font-mono truncate">{log.config_id.slice(0, 12)}…</p>
                                            )}
                                        </div>

                                        {/* Metadata */}
                                        <div className="min-w-0">
                                            {log.metadata && Object.keys(log.metadata).length > 0 ? (
                                                <p className="text-[10px] text-zinc-600 font-mono truncate">
                                                    {JSON.stringify(log.metadata)}
                                                </p>
                                            ) : (
                                                <span className="text-xs text-zinc-700">—</span>
                                            )}
                                        </div>

                                        {/* Time */}
                                        <div className="text-right">
                                            <p className="text-xs text-zinc-400" title={formatFull(log.created_at)}>
                                                {timeAgo(log.created_at)}
                                            </p>
                                            <p className="text-[10px] text-zinc-700 mt-0.5">
                                                {new Date(log.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                            </p>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between">
                        <p className="text-xs text-zinc-600">
                            Page {page + 1} of {totalPages} · {data?.total.toLocaleString()} total events
                        </p>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => handlePage(page - 1)}
                                disabled={page === 0}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-700 text-xs text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" /> Prev
                            </button>
                            <button
                                onClick={() => handlePage(page + 1)}
                                disabled={page >= totalPages - 1}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-700 text-xs text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                            >
                                Next <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </main>
    )
}
