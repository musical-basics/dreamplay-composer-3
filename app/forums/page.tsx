'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@clerk/nextjs'
import { MessageSquare, Pin, Plus, ChevronRight, Hash } from 'lucide-react'
import { HomeHeader } from '@/components/home/HomeHeader'
import { formatDistanceToNow } from 'date-fns'

type Thread = {
    id: string
    title: string
    body: string
    user_id: string
    category: string
    pinned: boolean
    reply_count: number
    created_at: string
}

const CATEGORIES = ['all', 'general', 'help', 'showcase', 'feedback', 'announcements']

const CATEGORY_STYLES: Record<string, string> = {
    general: 'bg-zinc-700/40 text-zinc-300',
    help: 'bg-blue-500/20 text-blue-300',
    showcase: 'bg-purple-500/20 text-purple-300',
    feedback: 'bg-amber-500/20 text-amber-300',
    announcements: 'bg-red-500/20 text-red-300',
}

export default function ForumsPage() {
    const { isSignedIn } = useUser()
    const [threads, setThreads] = useState<Thread[]>([])
    const [loading, setLoading] = useState(true)
    const [category, setCategory] = useState('all')
    const [showNewThread, setShowNewThread] = useState(false)
    const [newTitle, setNewTitle] = useState('')
    const [newBody, setNewBody] = useState('')
    const [newCategory, setNewCategory] = useState('general')
    const [posting, setPosting] = useState(false)

    const fetchThreads = async (cat: string) => {
        setLoading(true)
        const url = cat === 'all'
            ? '/api/forums/threads'
            : `/api/forums/threads?category=${cat}`
        const res = await fetch(url)
        const data = await res.json()
        setThreads(data.threads ?? [])
        setLoading(false)
    }

    useEffect(() => { fetchThreads(category) }, [category])

    const handlePost = async () => {
        if (!newTitle.trim() || !newBody.trim()) return
        setPosting(true)
        const res = await fetch('/api/forums/threads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTitle, body: newBody, category: newCategory }),
        })
        if (res.ok) {
            setNewTitle('')
            setNewBody('')
            setNewCategory('general')
            setShowNewThread(false)
            fetchThreads(category)
        }
        setPosting(false)
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-white">
            <HomeHeader />
            <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">Community Forums</h1>
                        <p className="text-sm text-zinc-400 mt-1">Discuss, share, and get help from the community</p>
                    </div>
                    {isSignedIn && (
                        <button
                            onClick={() => setShowNewThread(p => !p)}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-sm font-semibold transition-colors shadow-lg shadow-purple-500/20"
                        >
                            <Plus className="w-4 h-4" />
                            New Thread
                        </button>
                    )}
                </div>

                {/* New Thread Form */}
                {showNewThread && (
                    <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-5 space-y-4">
                        <h2 className="text-sm font-semibold">Create a New Thread</h2>
                        <input
                            value={newTitle}
                            onChange={e => setNewTitle(e.target.value)}
                            placeholder="Thread title…"
                            className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                        />
                        <textarea
                            value={newBody}
                            onChange={e => setNewBody(e.target.value)}
                            placeholder="What's on your mind?"
                            rows={5}
                            className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500 resize-none"
                        />
                        <div className="flex items-center gap-3">
                            <select
                                value={newCategory}
                                onChange={e => setNewCategory(e.target.value)}
                                className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-white focus:outline-none focus:border-purple-500"
                            >
                                {CATEGORIES.filter(c => c !== 'all').map(c => (
                                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                                ))}
                            </select>
                            <div className="flex-1" />
                            <button onClick={() => setShowNewThread(false)} className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white transition-colors">
                                Cancel
                            </button>
                            <button
                                onClick={handlePost}
                                disabled={posting || !newTitle.trim() || !newBody.trim()}
                                className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-sm font-semibold transition-colors"
                            >
                                {posting ? 'Posting…' : 'Post Thread'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Category filter */}
                <div className="flex items-center gap-2 flex-wrap">
                    {CATEGORIES.map(cat => (
                        <button
                            key={cat}
                            onClick={() => setCategory(cat)}
                            className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                                category === cat
                                    ? 'bg-purple-600 text-white border-purple-500'
                                    : 'border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500'
                            }`}
                        >
                            <Hash className="w-3 h-3" />
                            {cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </button>
                    ))}
                </div>

                {/* Thread list */}
                <div className="space-y-2">
                    {loading ? (
                        [...Array(5)].map((_, i) => (
                            <div key={i} className="h-20 rounded-xl bg-zinc-900 animate-pulse" />
                        ))
                    ) : threads.length === 0 ? (
                        <div className="text-center py-16 text-zinc-500 space-y-2">
                            <MessageSquare className="w-10 h-10 mx-auto opacity-30" />
                            <p className="text-sm">No threads yet.</p>
                            {isSignedIn && (
                                <button
                                    onClick={() => setShowNewThread(true)}
                                    className="text-xs text-purple-400 hover:underline"
                                >
                                    Be the first to start a discussion
                                </button>
                            )}
                        </div>
                    ) : (
                        threads.map(thread => (
                            <Link
                                key={thread.id}
                                href={`/forums/${thread.id}`}
                                className="flex items-center gap-4 p-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 transition-all group"
                            >
                                <div className="w-10 h-10 rounded-lg bg-zinc-800 group-hover:bg-zinc-700 flex items-center justify-center shrink-0 transition-colors">
                                    {thread.pinned
                                        ? <Pin className="w-4 h-4 text-amber-400" />
                                        : <MessageSquare className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        {thread.pinned && (
                                            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Pinned</span>
                                        )}
                                        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${CATEGORY_STYLES[thread.category] || CATEGORY_STYLES.general}`}>
                                            {thread.category}
                                        </span>
                                    </div>
                                    <p className="text-sm font-medium text-white group-hover:text-purple-300 transition-colors truncate">
                                        {thread.title}
                                    </p>
                                    <p className="text-xs text-zinc-500 mt-0.5">
                                        {formatDistanceToNow(new Date(thread.created_at), { addSuffix: true })}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1 text-xs text-zinc-500 shrink-0">
                                    <MessageSquare className="w-3.5 h-3.5" />
                                    <span>{thread.reply_count}</span>
                                </div>
                                <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors shrink-0" />
                            </Link>
                        ))
                    )}
                </div>

                {!isSignedIn && (
                    <p className="text-center text-xs text-zinc-500">
                        <Link href="/login" className="text-purple-400 hover:underline">Sign in</Link> to start or reply to threads
                    </p>
                )}
            </div>
        </div>
    )
}
