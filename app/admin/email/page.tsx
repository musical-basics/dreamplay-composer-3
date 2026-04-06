'use client'

import { useEffect, useState, useRef } from 'react'

type User = {
    id: string
    email: string | null
    first_name: string | null
    last_name: string | null
    email_unsubscribed: boolean | null
}

type SendStatus = 'idle' | 'sending' | 'done' | 'error'

type Result = {
    email: string
    status: 'sent' | 'failed' | 'skipped'
    error?: string
}

function displayName(u: User) {
    return [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || u.id
}

function previewBody(body: string, name: string) {
    return body.replace(/\{\{name\}\}/g, name || 'there')
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
    const [showPreview, setShowPreview] = useState(false)
    const [hideUnsubscribed, setHideUnsubscribed] = useState(false)
    const [togglingId, setTogglingId] = useState<string | null>(null)
    const [draftSaved, setDraftSaved] = useState(false)
    const [hasDraft, setHasDraft] = useState(false)
    const bodyRef = useRef<HTMLTextAreaElement>(null)

    // Restore draft from localStorage on mount
    useEffect(() => {
        try {
            const raw = localStorage.getItem('admin_email_draft')
            if (raw) {
                const draft = JSON.parse(raw)
                if (draft.subject) setSubject(draft.subject)
                if (draft.body) setBody(draft.body)
                setHasDraft(true)
            }
        } catch { /* ignore */ }
    }, [])

    const saveDraft = () => {
        localStorage.setItem('admin_email_draft', JSON.stringify({ subject, body }))
        setHasDraft(true)
        setDraftSaved(true)
        setTimeout(() => setDraftSaved(false), 2000)
    }

    const clearDraft = () => {
        localStorage.removeItem('admin_email_draft')
        setHasDraft(false)
        setSubject('')
        setBody('')
    }

    useEffect(() => {
        fetch('/api/admin/users')
            .then(r => r.json())
            .then(data => {
                setUsers(data.users ?? [])
                setLoadingUsers(false)
            })
            .catch(() => setLoadingUsers(false))
    }, [])

    const filtered = users.filter(u => {
        if (hideUnsubscribed && u.email_unsubscribed) return false
        if (!search) return true
        return (
            u.email?.toLowerCase().includes(search.toLowerCase()) ||
            u.first_name?.toLowerCase().includes(search.toLowerCase()) ||
            u.last_name?.toLowerCase().includes(search.toLowerCase())
        )
    })

    const unsubscribedCount = users.filter(u => u.email_unsubscribed).length

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

    // Toggle unsubscribe status for a user (admin override/undo)
    const toggleUnsubscribe = async (user: User) => {
        setTogglingId(user.id)
        const newVal = !user.email_unsubscribed
        try {
            const res = await fetch('/api/admin/toggle-unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.id, unsubscribed: newVal }),
            })
            if (res.ok) {
                setUsers(prev => prev.map(u =>
                    u.id === user.id ? { ...u, email_unsubscribed: newVal } : u
                ))
            }
        } catch {
            // silent
        } finally {
            setTogglingId(null)
        }
    }

    // Insert {{name}} at cursor position
    const insertName = () => {
        const ta = bodyRef.current
        if (!ta) { setBody(b => b + '{{name}}'); return }
        const start = ta.selectionStart
        const end = ta.selectionEnd
        const next = body.slice(0, start) + '{{name}}' + body.slice(end)
        setBody(next)
        setTimeout(() => {
            ta.selectionStart = ta.selectionEnd = start + '{{name}}'.length
            ta.focus()
        }, 0)
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

            // Skip opted-out users
            if (user.email_unsubscribed) {
                setResults(prev => [...prev, { email: user.email!, status: 'skipped' }])
                continue
            }

            const name = displayName(user)
            try {
                const res = await fetch('/api/admin/send-email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ to: user.email, name, userId: user.id, subject, body }),
                })
                const data = await res.json()
                if (!res.ok) throw new Error(data.error || 'Send failed')
                setResults(prev => [...prev, { email: user.email!, status: 'sent' }])
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Unknown error'
                setResults(prev => [...prev, { email: user.email!, status: 'failed', error: message }])
            }
            if (i < targets.length - 1) await new Promise(r => setTimeout(r, 300))
        }

        setSendStatus('done')
    }

    const canSend = selected.size > 0 && subject.trim() && body.trim() && sendStatus !== 'sending'
    const firstSelected = users.find(u => selected.has(u.id))
    const previewName = firstSelected ? displayName(firstSelected) : 'Alex'

    return (
        <main className="min-h-screen bg-black text-white p-6">
            <div className="max-w-6xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">Admin Email</h1>
                        <p className="text-sm text-neutral-400 mt-1">
                            Send emails to users — fires one email per recipient · use{' '}
                            <code className="text-purple-400">{'{{name}}'}</code> for personalisation
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
                            {/* Unsubscribed toggle */}
                            {unsubscribedCount > 0 && (
                                <button
                                    onClick={() => setHideUnsubscribed(p => !p)}
                                    className={`flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md transition-colors border ${
                                        hideUnsubscribed
                                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                            : 'text-neutral-400 border-neutral-700 hover:text-white'
                                    }`}
                                >
                                    <span className={`w-2 h-2 rounded-full ${hideUnsubscribed ? 'bg-amber-400' : 'bg-neutral-600'}`} />
                                    {hideUnsubscribed
                                        ? `Hiding ${unsubscribedCount} unsubscribed`
                                        : `Show all (${unsubscribedCount} unsubscribed)`}
                                </button>
                            )}
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
                                        className={`flex items-center gap-3 px-4 py-3 hover:bg-neutral-900 cursor-pointer border-b border-neutral-900 last:border-0 transition-colors ${user.email_unsubscribed ? 'opacity-50' : ''}`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selected.has(user.id)}
                                            onChange={() => toggleUser(user.id)}
                                            className="w-4 h-4 accent-purple-500 shrink-0"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-medium truncate">{displayName(user)}</p>
                                                {user.email_unsubscribed && (
                                                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/20">
                                                        unsub
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-neutral-500 truncate">{user.email || 'no email'}</p>
                                        </div>
                                        {/* Admin toggle */}
                                        <button
                                            onClick={e => { e.preventDefault(); toggleUnsubscribe(user) }}
                                            disabled={togglingId === user.id}
                                            title={user.email_unsubscribed ? 'Re-subscribe this user' : 'Mark as unsubscribed'}
                                            className={`shrink-0 text-[10px] px-2 py-0.5 rounded border transition-colors ${
                                                user.email_unsubscribed
                                                    ? 'border-green-600/40 text-green-400 hover:bg-green-500/10'
                                                    : 'border-neutral-700 text-neutral-600 hover:text-red-400 hover:border-red-500/40'
                                            }`}
                                        >
                                            {togglingId === user.id ? '…' : user.email_unsubscribed ? 'Re-sub' : 'Unsub'}
                                        </button>
                                    </label>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Right: email composer */}
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <h2 className="text-sm font-semibold">Compose</h2>
                                {hasDraft && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/20 font-medium">Draft</span>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                {/* Save Draft */}
                                <button
                                    onClick={saveDraft}
                                    disabled={!subject.trim() && !body.trim()}
                                    className="px-2 py-1 rounded-md text-xs transition-colors border border-blue-600/40 text-blue-400 hover:bg-blue-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                    {draftSaved ? '✓ Saved!' : 'Save Draft'}
                                </button>
                                {hasDraft && (
                                    <button
                                        onClick={clearDraft}
                                        className="px-2 py-1 rounded-md text-xs transition-colors border border-neutral-700 text-neutral-500 hover:text-red-400 hover:border-red-500/40"
                                    >
                                        Clear
                                    </button>
                                )}
                                <button
                                    onClick={insertName}
                                    title="Insert {{name}} at cursor"
                                    className="px-2 py-1 rounded-md bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 text-xs font-mono transition-colors border border-purple-500/30"
                                >
                                    {'{{name}}'}
                                </button>
                                <button
                                    onClick={() => setShowPreview(p => !p)}
                                    className={`px-2 py-1 rounded-md text-xs transition-colors border ${showPreview ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : 'text-neutral-400 border-neutral-700 hover:text-white'}`}
                                >
                                    {showPreview ? 'Hide preview' : 'Preview'}
                                </button>
                            </div>
                        </div>

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
                            {showPreview ? (
                                <div className="w-full px-3 py-2.5 rounded-lg bg-neutral-900 border border-amber-500/30 text-sm text-white min-h-[200px] whitespace-pre-wrap leading-relaxed">
                                    {previewBody(body, previewName) || <span className="text-neutral-600">Preview will appear here…</span>}
                                    <div className="mt-6 pt-4 border-t border-neutral-700 text-xs text-neutral-500">
                                        Previewing as: <span className="text-amber-400">{previewName}</span>
                                    </div>
                                </div>
                            ) : (
                                <textarea
                                    ref={bodyRef}
                                    value={body}
                                    onChange={e => setBody(e.target.value)}
                                    placeholder={"Dear {{name}},\n\nWrite your message here…"}
                                    rows={12}
                                    className="w-full px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 resize-none font-mono"
                                />
                            )}
                        </div>

                        <p className="text-xs text-neutral-500">
                            An unsubscribe link is added automatically. Opted-out users are skipped.
                        </p>

                        <button
                            onClick={handleSend}
                            disabled={!canSend}
                            className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold transition-colors"
                        >
                            {sendStatus === 'sending'
                                ? `Sending ${progress.current} / ${progress.total}…`
                                : `Send to ${selected.size} recipient${selected.size !== 1 ? 's' : ''}`}
                        </button>

                        {results.length > 0 && (
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                                <p className="text-xs text-neutral-400 mb-2">Results</p>
                                {results.map((r, i) => (
                                    <div key={i} className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg ${
                                        r.status === 'sent' ? 'bg-green-500/10 text-green-400' :
                                        r.status === 'skipped' ? 'bg-neutral-800 text-neutral-500' :
                                        'bg-red-500/10 text-red-400'
                                    }`}>
                                        <span>{r.status === 'sent' ? '✓' : r.status === 'skipped' ? '⊘' : '✗'}</span>
                                        <span className="truncate">{r.email}</span>
                                        {r.status === 'skipped' && <span className="text-neutral-600">— opted out</span>}
                                        {r.error && <span className="text-red-300 truncate">— {r.error}</span>}
                                    </div>
                                ))}
                                {sendStatus === 'done' && (
                                    <p className="text-xs text-neutral-400 mt-2">
                                        {results.filter(r => r.status === 'sent').length} sent ·{' '}
                                        {results.filter(r => r.status === 'skipped').length} skipped ·{' '}
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
