'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@clerk/nextjs'
import { ArrowLeft, MessageSquare, Send } from 'lucide-react'
import { HomeHeader } from '@/components/home/HomeHeader'
import { formatDistanceToNow } from 'date-fns'
import { use } from 'react'

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

type Post = {
    id: string
    body: string
    user_id: string
    created_at: string
}

type UserInfo = { name: string; avatarUrl?: string }

const CATEGORY_STYLES: Record<string, string> = {
    general: 'bg-zinc-700/40 text-zinc-300',
    help: 'bg-blue-500/20 text-blue-300',
    showcase: 'bg-purple-500/20 text-purple-300',
    feedback: 'bg-amber-500/20 text-amber-300',
    announcements: 'bg-red-500/20 text-red-300',
}

async function fetchUserInfo(ids: string[]): Promise<Record<string, UserInfo>> {
    if (!ids.length) return {}
    const res = await fetch(`/api/forums/users?ids=${ids.join(',')}`)
    const data = await res.json()
    return data.users ?? {}
}

export default function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params)
    const { isSignedIn } = useUser()
    const [thread, setThread] = useState<Thread | null>(null)
    const [posts, setPosts] = useState<Post[]>([])
    const [users, setUsers] = useState<Record<string, UserInfo>>({})
    const [loading, setLoading] = useState(true)
    const [reply, setReply] = useState('')
    const [posting, setPosting] = useState(false)

    useEffect(() => {
        Promise.all([
            fetch(`/api/forums/threads`).then(r => r.json()),
            fetch(`/api/forums/posts?thread_id=${id}`).then(r => r.json()),
        ]).then(async ([threadsData, postsData]) => {
            const found: Thread | undefined = (threadsData.threads ?? []).find((t: Thread) => t.id === id)
            const postsArr: Post[] = postsData.posts ?? []
            setThread(found ?? null)
            setPosts(postsArr)

            // Batch-fetch real user names
            const allIds = [...new Set([
                ...(found ? [found.user_id] : []),
                ...postsArr.map((p: Post) => p.user_id),
            ])]
            const info = await fetchUserInfo(allIds)
            setUsers(info)
            setLoading(false)
        })
    }, [id])

    const handleReply = async () => {
        if (!reply.trim()) return
        setPosting(true)
        const res = await fetch('/api/forums/posts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ thread_id: id, body: reply }),
        })
        if (res.ok) {
            const data = await res.json()
            const newPost: Post = data.post
            setPosts(prev => [...prev, newPost])
            // Fetch name for new poster if needed
            if (!users[newPost.user_id]) {
                const info = await fetchUserInfo([newPost.user_id])
                setUsers(prev => ({ ...prev, ...info }))
            }
            setReply('')
        }
        setPosting(false)
    }

    const userName = (userId: string) => users[userId]?.name ?? `@user-${userId.slice(-6)}`

    if (loading) {
        return (
            <div className="min-h-screen bg-zinc-950 text-white">
                <HomeHeader />
                <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-24 rounded-xl bg-zinc-900 animate-pulse" />
                    ))}
                </div>
            </div>
        )
    }

    if (!thread) {
        return (
            <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
                <div className="text-center space-y-3">
                    <p className="text-zinc-400">Thread not found</p>
                    <Link href="/forums" className="text-purple-400 hover:underline text-sm">Back to Forums</Link>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-white">
            <HomeHeader />
            <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
                {/* Back */}
                <Link href="/forums" className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors w-fit">
                    <ArrowLeft className="w-4 h-4" /> Forums
                </Link>

                {/* Thread header */}
                <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-6 space-y-3">
                    <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${CATEGORY_STYLES[thread.category] || CATEGORY_STYLES.general}`}>
                            {thread.category}
                        </span>
                        {thread.pinned && (
                            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Pinned</span>
                        )}
                    </div>
                    <h1 className="text-xl font-bold">{thread.title}</h1>
                    <div className="text-xs text-zinc-500">
                        Posted by{' '}
                        <span className="text-zinc-300 font-medium">{userName(thread.user_id)}</span>
                        {' '}· {formatDistanceToNow(new Date(thread.created_at), { addSuffix: true })}
                    </div>
                    <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{thread.body}</p>
                </div>

                {/* Replies */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-zinc-500 px-1">
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>{posts.length} {posts.length === 1 ? 'reply' : 'replies'}</span>
                    </div>
                    {posts.map((post, i) => (
                        <div key={post.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-5 py-4 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-zinc-300">{userName(post.user_id)}</span>
                                <span className="text-[11px] text-zinc-600">
                                    #{i + 1} · {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                                </span>
                            </div>
                            <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">{post.body}</p>
                        </div>
                    ))}
                </div>

                {/* Reply box */}
                {isSignedIn ? (
                    <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 space-y-3">
                        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Your Reply</h3>
                        <textarea
                            value={reply}
                            onChange={e => setReply(e.target.value)}
                            placeholder="Write a reply…"
                            rows={4}
                            className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500 resize-none"
                        />
                        <div className="flex justify-end">
                            <button
                                onClick={handleReply}
                                disabled={posting || !reply.trim()}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-sm font-semibold transition-colors"
                            >
                                <Send className="w-3.5 h-3.5" />
                                {posting ? 'Posting…' : 'Post Reply'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-6 text-sm text-zinc-500">
                        <Link href="/login" className="text-purple-400 hover:underline">Sign in</Link> to reply to this thread
                    </div>
                )}
            </div>
        </div>
    )
}
