'use client'

import { useEffect, useState, useMemo } from 'react'

type UserInfo = {
    email: string | null
    first_name: string | null
    last_name: string | null
}

type Config = {
    id: string
    title: string | null
    user_id: string
    audio_url: string | null
    xml_url: string | null
    midi_url: string | null
    is_published: boolean
    created_at: string
    updated_at: string
    users: UserInfo | null
}

function AssetButton({ url, label, color }: { url: string | null; label: string; color: string }) {
    if (!url) {
        return (
            <span className={`px-2 py-1 rounded text-xs font-mono opacity-30 bg-neutral-800 text-neutral-500`}>
                no {label}
            </span>
        )
    }
    return (
        <a
            href={url}
            download
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold transition-opacity hover:opacity-80 ${color}`}
        >
            ↓ {label}
        </a>
    )
}

export default function AdminDebugPage() {
    const [configs, setConfigs] = useState<Config[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState('')
    const [filter, setFilter] = useState<'all' | 'published' | 'private'>('all')
    const [sortBy, setSortBy] = useState<'updated' | 'created' | 'title'>('updated')

    useEffect(() => {
        fetch('/api/admin/configs')
            .then(r => r.json())
            .then(d => {
                if (d.error) setError(d.error)
                else setConfigs(d.configs ?? [])
                setLoading(false)
            })
            .catch(e => { setError(e.message); setLoading(false) })
    }, [])

    const displayName = (c: Config) => {
        const u = c.users
        if (!u) return c.user_id.slice(0, 12) + '…'
        const name = [u.first_name, u.last_name].filter(Boolean).join(' ')
        return name || u.email || c.user_id.slice(0, 12) + '…'
    }

    const filtered = useMemo(() => {
        let list = configs
        if (filter === 'published') list = list.filter(c => c.is_published)
        if (filter === 'private') list = list.filter(c => !c.is_published)
        if (search) {
            const q = search.toLowerCase()
            list = list.filter(c =>
                c.id.includes(q) ||
                c.title?.toLowerCase().includes(q) ||
                c.users?.email?.toLowerCase().includes(q) ||
                c.users?.first_name?.toLowerCase().includes(q) ||
                c.users?.last_name?.toLowerCase().includes(q)
            )
        }
        return [...list].sort((a, b) => {
            if (sortBy === 'title') return (a.title ?? '').localeCompare(b.title ?? '')
            if (sortBy === 'created') return b.created_at.localeCompare(a.created_at)
            return b.updated_at.localeCompare(a.updated_at)
        })
    }, [configs, filter, search, sortBy])

    const stats = useMemo(() => ({
        total: configs.length,
        published: configs.filter(c => c.is_published).length,
        withAudio: configs.filter(c => c.audio_url).length,
        withXml: configs.filter(c => c.xml_url).length,
        withMidi: configs.filter(c => c.midi_url).length,
    }), [configs])

    return (
        <main className="min-h-screen bg-black text-white p-6">
            <div className="max-w-[1400px] mx-auto space-y-6">

                {/* Header */}
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <h1 className="text-2xl font-bold">Admin Debug</h1>
                        <p className="text-sm text-neutral-400 mt-1">All user configurations with asset links</p>
                    </div>
                    <div className="flex gap-3 flex-wrap">
                        <a href="/admin/email" className="text-xs px-3 py-1.5 rounded-lg border border-neutral-700 hover:border-neutral-500 transition-colors">
                            → Email Users
                        </a>
                    </div>
                </div>

                {/* Stats */}
                {!loading && !error && (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        {[
                            { label: 'Total configs', value: stats.total },
                            { label: 'Published', value: stats.published, color: 'text-green-400' },
                            { label: 'With audio', value: stats.withAudio, color: 'text-blue-400' },
                            { label: 'With XML', value: stats.withXml, color: 'text-amber-400' },
                            { label: 'With MIDI', value: stats.withMidi, color: 'text-purple-400' },
                        ].map(s => (
                            <div key={s.label} className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3">
                                <p className="text-xs text-neutral-500">{s.label}</p>
                                <p className={`text-2xl font-bold mt-1 ${s.color ?? 'text-white'}`}>{s.value}</p>
                            </div>
                        ))}
                    </div>
                )}

                {/* Controls */}
                <div className="flex gap-3 flex-wrap items-center">
                    <input
                        type="text"
                        placeholder="Search by title, email, config ID…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="flex-1 min-w-[240px] px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500"
                    />
                    <div className="flex rounded-lg border border-neutral-700 overflow-hidden text-xs font-medium">
                        {(['all', 'published', 'private'] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={`px-3 py-2 capitalize transition-colors ${filter === f ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-white'}`}
                            >
                                {f}
                            </button>
                        ))}
                    </div>
                    <select
                        value={sortBy}
                        onChange={e => setSortBy(e.target.value as typeof sortBy)}
                        className="px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-sm text-white focus:outline-none"
                    >
                        <option value="updated">Sort: Last updated</option>
                        <option value="created">Sort: Created</option>
                        <option value="title">Sort: Title</option>
                    </select>
                    <span className="text-xs text-neutral-500">{filtered.length} configs</span>
                </div>

                {/* Table */}
                {loading ? (
                    <div className="text-center py-16 text-neutral-500">Loading…</div>
                ) : error ? (
                    <div className="text-center py-16 text-red-400">{error}</div>
                ) : (
                    <div className="rounded-xl border border-neutral-800 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-neutral-800 bg-neutral-950">
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 whitespace-nowrap">User</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 whitespace-nowrap">Title</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 whitespace-nowrap">Config ID</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 whitespace-nowrap">Status</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 whitespace-nowrap">Assets</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 whitespace-nowrap">Updated</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 whitespace-nowrap">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-900">
                                    {filtered.map(c => (
                                        <tr key={c.id} className="hover:bg-neutral-900/50 transition-colors">
                                            {/* User */}
                                            <td className="px-4 py-3">
                                                <p className="font-medium text-white text-sm">{displayName(c)}</p>
                                                <p className="text-xs text-neutral-500 truncate max-w-[180px]">
                                                    {c.users?.email ?? <span className="italic">no email</span>}
                                                </p>
                                            </td>

                                            {/* Title */}
                                            <td className="px-4 py-3">
                                                <span className="text-sm text-neutral-200 font-medium">
                                                    {c.title || <span className="text-neutral-600 italic">Untitled</span>}
                                                </span>
                                            </td>

                                            {/* Config ID */}
                                            <td className="px-4 py-3">
                                                <button
                                                    onClick={() => navigator.clipboard.writeText(c.id)}
                                                    className="font-mono text-xs text-neutral-400 hover:text-white transition-colors truncate max-w-[140px] block"
                                                    title="Click to copy"
                                                >
                                                    {c.id}
                                                </button>
                                            </td>

                                            {/* Status */}
                                            <td className="px-4 py-3">
                                                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                                                    c.is_published
                                                        ? 'bg-green-500/15 text-green-400'
                                                        : 'bg-neutral-800 text-neutral-500'
                                                }`}>
                                                    {c.is_published ? 'Published' : 'Private'}
                                                </span>
                                            </td>

                                            {/* Assets */}
                                            <td className="px-4 py-3">
                                                <div className="flex flex-wrap gap-1.5">
                                                    <AssetButton url={c.audio_url} label="Audio" color="bg-blue-500/20 text-blue-300" />
                                                    <AssetButton url={c.xml_url} label="XML" color="bg-amber-500/20 text-amber-300" />
                                                    <AssetButton url={c.midi_url} label="MIDI" color="bg-purple-500/20 text-purple-300" />
                                                </div>
                                            </td>

                                            {/* Updated */}
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span className="text-xs text-neutral-500">
                                                    {new Date(c.updated_at).toLocaleDateString('en-US', {
                                                        month: 'short', day: 'numeric', year: 'numeric'
                                                    })}
                                                </span>
                                                <p className="text-xs text-neutral-600">
                                                    {new Date(c.updated_at).toLocaleTimeString('en-US', {
                                                        hour: '2-digit', minute: '2-digit'
                                                    })}
                                                </p>
                                            </td>

                                            {/* Actions */}
                                            <td className="px-4 py-3">
                                                <div className="flex gap-2">
                                                    <a
                                                        href={`/admin/view/${c.id}`}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="px-2.5 py-1 rounded-lg bg-purple-600/20 text-purple-300 text-xs font-semibold hover:bg-purple-600/40 transition-colors whitespace-nowrap"
                                                    >
                                                        👁 View
                                                    </a>
                                                    <a
                                                        href={`/studio2/edit/${c.id}`}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="px-2.5 py-1 rounded-lg bg-neutral-700/50 text-neutral-300 text-xs font-semibold hover:bg-neutral-700 transition-colors whitespace-nowrap"
                                                    >
                                                        ✎ Edit
                                                    </a>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {filtered.length === 0 && (
                                <div className="text-center py-12 text-neutral-500 text-sm">No configs found</div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </main>
    )
}
