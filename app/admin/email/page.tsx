'use client'

import { useEffect, useState } from 'react'

type User = {
    id: string
    email: string | null
    first_name: string | null
    last_name: string | null
}

type SendStatus = 'idle' | 'sending' | 'done' | 'error'

type Result = {
    email: string
    status: 'sent' | 'failed'
    error?: string
}

export default function AdminEmailPage() {
    const [users, setUsers] = useState<User[]>([])
    const [loadingUsers, setLoadingUsers] = useState(true)
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [subject, setSubject] = useState('')
    const [body, setBody] = useState('')
    const [sendStatus, setSendStatus] = useState<SendStatus>('idle')
    const [progress, setProgress] = useState({ current: 0, total: 0 })
    const [results, setResults] = useState<Result[]>([])
    const [search, setSearch] = useState('')

    useEffect(() => {
        fetch('/api/admin/users')
            .then(r => r.json())
            .then(data => {
                setUsers(data.users ?? [])
                setLoadingUsers(false)
            })
            .catch(() => setLoadingUsers(false))
    }, [])

    const filtered = users.filter(u =>
        !search ||
        u.email?.toLowerCase().includes(search.toLowerCase()) ||
        u.first_name?.toLowerCase().includes(search.toLowerCase()) ||
        u.last_name?.toLowerCase().includes(search.toLowerCase())
    )

    const toggleUser = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
    }

    const toggleAll = () => {
        if (selected.size === filtered.length) {
            setSelected(new Set())
        } else {
            setSelected(new Set(filtered.map(u => u.id)))
        }
    }

    const handleSend = async () => {
        if (!subject.trim() || !body.trim()) return
        const targets = users.filter(u => selected.has(u.id) && u.email)
        if (targets.length === 0) return

        setSendStatus('sending')
        setProgress({ current: 0, total: targets.length })
        setResults([])

        for (let i = 0; i < targets.length; i++) {
            const user = targets[i]
            setProgress({ current: i + 1, total: targets.length })
            try {
                const res = await fetch('/api/admin/send-email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ to: user.email, subject, body }),
                })
                const data = await res.json()
                if (!res.ok) throw new Error(data.error || 'Send failed')
                setResults(prev => [...prev, { email: user.email!, status: 'sent' }])
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Unknown error'
                setResults(prev => [...prev, { email: user.email!, status: 'failed', error: message }])
            }
            // Small delay between sends to avoid Resend rate limits
            if (i < targets.length - 1) await new Promise(r => setTimeout(r, 300))
        }

        setSendStatus('done')
    }

    const canSend = selected.size > 0 && subject.trim() && body.trim() && sendStatus !== 'sending'
    const displayName = (u: User) =>
        [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || u.id

    return (
        <main className="min-h-screen bg-black text-white p-6">
            <div className="max-w-6xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">Admin Email</h1>
                        <p className="text-sm text-neutral-400 mt-1">
                            Send emails to users — fires one email per recipient
                        </p>
                    </div>
                    {sendStatus === 'sending' && (
                        <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-purple-500/10 border border-purple-500/30">
                            <div className="w-3.5 h-3.5 rounded-full border-2 border-purple-400 border-t-transparent animate-spin" />
                            <span className="text-sm text-purple-300 font-medium">
                                Sending {progress.current} / {progress.total}…
                            </span>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Left: user selector */}
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 flex flex-col">
                        <div className="p-4 border-b border-neutral-800 space-y-3">
                            <div className="flex items-center justify-between">
                                <h2 className="text-sm font-semibold">
                                    Recipients
                                    {selected.size > 0 && (
                                        <span className="ml-2 px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-xs">
                                            {selected.size} selected
                                        </span>
                                    )}
                                </h2>
                                <button
                                    onClick={toggleAll}
                                    className="text-xs text-neutral-400 hover:text-white transition-colors"
                                >
                                    {selected.size === filtered.length ? 'Deselect all' : 'Select all'}
                                </button>
                            </div>
                            <input
                                type="text"
                                placeholder="Search by name or email…"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500"
                            />
                        </div>

                        <div className="overflow-y-auto flex-1 max-h-[420px]">
                            {loadingUsers ? (
                                <div className="p-6 text-center text-neutral-500 text-sm">Loading users…</div>
                            ) : filtered.length === 0 ? (
                                <div className="p-6 text-center text-neutral-500 text-sm">No users found</div>
                            ) : (
                                filtered.map(user => (
                                    <label
                                        key={user.id}
                                        className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-900 cursor-pointer border-b border-neutral-900 last:border-0 transition-colors"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selected.has(user.id)}
                                            onChange={() => toggleUser(user.id)}
                                            className="w-4 h-4 accent-purple-500"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{displayName(user)}</p>
                                            <p className="text-xs text-neutral-500 truncate">{user.email || 'no email'}</p>
                                        </div>
                                    </label>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Right: email composer */}
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5 space-y-4">
                        <h2 className="text-sm font-semibold">Compose</h2>

                        <div className="space-y-1">
                            <label className="text-xs text-neutral-400">Subject</label>
                            <input
                                type="text"
                                value={subject}
                                onChange={e => setSubject(e.target.value)}
                                placeholder="e.g. .mxl uploads now working on DreamPlay Studio"
                                className="w-full px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500"
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs text-neutral-400">Message</label>
                            <textarea
                                value={body}
                                onChange={e => setBody(e.target.value)}
                                placeholder="Write your message here…"
                                rows={12}
                                className="w-full px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 resize-none font-mono"
                            />
                        </div>

                        <button
                            onClick={handleSend}
                            disabled={!canSend}
                            className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold transition-colors"
                        >
                            {sendStatus === 'sending'
                                ? `Sending ${progress.current} / ${progress.total}…`
                                : `Send to ${selected.size} recipient${selected.size !== 1 ? 's' : ''}`}
                        </button>

                        {/* Results */}
                        {results.length > 0 && (
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                                <p className="text-xs text-neutral-400 mb-2">Results</p>
                                {results.map((r, i) => (
                                    <div key={i} className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg ${r.status === 'sent' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                        <span>{r.status === 'sent' ? '✓' : '✗'}</span>
                                        <span className="truncate">{r.email}</span>
                                        {r.error && <span className="text-red-300 truncate">— {r.error}</span>}
                                    </div>
                                ))}
                                {sendStatus === 'done' && (
                                    <p className="text-xs text-neutral-400 mt-2">
                                        {results.filter(r => r.status === 'sent').length} sent ·{' '}
                                        {results.filter(r => r.status === 'failed').length} failed
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </main>
    )
}
