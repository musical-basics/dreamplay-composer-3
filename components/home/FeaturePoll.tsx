'use client'

import { useState, useTransition } from 'react'
import { useUser } from '@clerk/nextjs'
import { SignInButton } from '@clerk/nextjs'
import { Lock, CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import type { PollOptionKey, PollResults } from '@/app/actions/poll'
import { submitVoteAction } from '@/app/actions/poll'

const POLL_OPTIONS: { key: PollOptionKey; letter: string; label: string; emoji: string }[] = [
    { key: 'video_export',       letter: 'A', label: 'Video export',                    emoji: '🎬' },
    { key: 'other_instruments',  letter: 'B', label: 'Support for other instruments',   emoji: '🎸' },
    { key: 'longer_videos',      letter: 'C', label: '10min+ videos',                   emoji: '⏱️' },
    { key: 'more_effects',       letter: 'D', label: 'More effects & modifiers',        emoji: '✨' },
    { key: 'something_else',     letter: 'E', label: 'Something else',                  emoji: '💡' },
]

interface FeaturePollProps {
    initialResults: PollResults
}

export function FeaturePoll({ initialResults }: FeaturePollProps) {
    const { isLoaded, isSignedIn } = useUser()
    const [results, setResults] = useState<PollResults>(initialResults)
    const [isPending, startTransition] = useTransition()
    const [hoveredKey, setHoveredKey] = useState<PollOptionKey | null>(null)

    const maxCount = Math.max(...Object.values(results.counts), 1)
    const leadingKey = Object.entries(results.counts).reduce((a, b) =>
        b[1] > a[1] ? b : a
    )[0] as PollOptionKey

    const handleVote = (optionKey: PollOptionKey) => {
        if (!isSignedIn) return
        if (results.userVote === optionKey) return // already voted this
        startTransition(async () => {
            try {
                const updated = await submitVoteAction(optionKey)
                setResults(updated)
            } catch (err) {
                console.error('[Poll] vote failed:', err)
            }
        })
    }

    return (
        <div className="relative rounded-2xl border border-purple-500/20 bg-gradient-to-br from-zinc-900/80 to-zinc-950 overflow-hidden shadow-2xl shadow-purple-900/20">
                {/* Ambient glow */}
                <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-48 bg-purple-500/10 rounded-full blur-[80px] pointer-events-none" />
                <div className="absolute -bottom-12 right-12 w-64 h-32 bg-pink-500/8 rounded-full blur-[60px] pointer-events-none" />

                <div className="relative p-6 sm:p-8">
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-7">
                        <div>
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 mb-3">
                                <Sparkles className="w-3 h-3 text-purple-400" />
                                <span className="text-xs font-medium text-purple-300 tracking-wide">Community Poll</span>
                            </div>
                            <h2 className="text-xl sm:text-2xl font-bold text-white leading-tight">
                                What feature do you want next?
                            </h2>
                            <p className="text-sm text-zinc-500 mt-1">
                                {results.total} {results.total === 1 ? 'vote' : 'votes'} cast
                                {results.userVote && <span className="text-purple-400 ml-2">· Your vote is recorded ✓</span>}
                            </p>
                        </div>

                        {/* Auth state badge */}
                        {isLoaded && !isSignedIn && (
                            <SignInButton mode="modal">
                                <button className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-all duration-200 shadow-lg shadow-purple-600/30">
                                    <Lock className="w-3.5 h-3.5" />
                                    Log in to vote
                                </button>
                            </SignInButton>
                        )}
                    </div>

                    {/* Options */}
                    <div className="space-y-3">
                        {POLL_OPTIONS.map((opt) => {
                            const count = results.counts[opt.key]
                            const pct = results.total > 0
                                ? Math.round((count / results.total) * 100)
                                : 0
                            const barPct = Math.round((count / maxCount) * 100)
                            const isUserVote = results.userVote === opt.key
                            const isLeading = opt.key === leadingKey && results.total > 0
                            const isHovered = hoveredKey === opt.key
                            const canVote = isLoaded && isSignedIn && !isPending

                            return (
                                <button
                                    key={opt.key}
                                    onClick={() => handleVote(opt.key)}
                                    onMouseEnter={() => setHoveredKey(opt.key)}
                                    onMouseLeave={() => setHoveredKey(null)}
                                    disabled={!canVote}
                                    className={`
                                        relative w-full text-left rounded-xl border transition-all duration-200 overflow-hidden group
                                        ${isUserVote
                                            ? 'border-purple-500/60 bg-purple-500/8 shadow-md shadow-purple-900/30'
                                            : isHovered && canVote
                                                ? 'border-zinc-600/50 bg-zinc-800/60 cursor-pointer'
                                                : 'border-zinc-800/60 bg-zinc-900/40'
                                        }
                                        ${!canVote ? 'cursor-default' : ''}
                                    `}
                                >
                                    {/* Progress bar fill */}
                                    <div
                                        className={`absolute inset-0 transition-all duration-700 ease-out rounded-xl ${
                                            isUserVote
                                                ? 'bg-purple-500/12'
                                                : 'bg-zinc-700/20'
                                        }`}
                                        style={{ width: `${barPct}%` }}
                                    />

                                    {/* Content row */}
                                    <div className="relative flex items-center gap-3 px-4 py-3.5">
                                        {/* Letter badge */}
                                        <span className={`
                                            flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold transition-all duration-200
                                            ${isUserVote
                                                ? 'bg-purple-500 text-white shadow-sm shadow-purple-500/50'
                                                : 'bg-zinc-800 text-zinc-400 group-hover:bg-zinc-700'
                                            }
                                        `}>
                                            {opt.letter}
                                        </span>

                                        {/* Emoji + Label */}
                                        <span className="text-sm mr-1 select-none">{opt.emoji}</span>
                                        <span className={`flex-1 text-sm font-medium transition-colors duration-200 ${
                                            isUserVote ? 'text-white' : 'text-zinc-300'
                                        }`}>
                                            {opt.label}
                                        </span>

                                        {/* Right side: leading badge, check, pct */}
                                        <div className="flex items-center gap-2">
                                            {isLeading && results.total > 0 && (
                                                <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-400 border border-amber-400/25">
                                                    Leading
                                                </span>
                                            )}
                                            {isUserVote && (
                                                <CheckCircle2 className="w-4 h-4 text-purple-400 flex-shrink-0" />
                                            )}
                                            {isPending && isUserVote && (
                                                <Loader2 className="w-3.5 h-3.5 text-purple-400 animate-spin" />
                                            )}
                                            <span className={`text-sm font-mono font-semibold min-w-[38px] text-right transition-colors duration-200 ${
                                                isUserVote ? 'text-purple-300' : 'text-zinc-500'
                                            }`}>
                                                {pct}%
                                            </span>
                                        </div>
                                    </div>
                                </button>
                            )
                        })}
                    </div>

                    {/* Footer */}
                    <div className="mt-5 flex items-center justify-between">
                        <p className="text-xs text-zinc-600">
                            Results update in real time · One vote per account
                        </p>
                        {isPending && (
                            <span className="flex items-center gap-1.5 text-xs text-purple-400">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Saving vote...
                            </span>
                        )}
                        {results.userVote && !isPending && (
                            <span className="text-xs text-zinc-600">
                                You can change your vote anytime
                            </span>
                        )}
                    </div>
                </div>
        </div>
    )
}
