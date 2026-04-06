'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Search, Music, Eye, Calendar, X, TrendingUp, Clock, ArrowUpAZ, Play, ChevronDown } from 'lucide-react'
import { fetchPublishedConfigsSortedAction, updateConfigAction } from '@/app/actions/config'
import type { SongConfig } from '@/lib/types'

type SortMode = 'recent' | 'popular' | 'az'
type DifficultyFilter = 'all' | 'beginner' | 'intermediate' | 'advanced'
type Difficulty = 'beginner' | 'intermediate' | 'advanced'

const PAGE_SIZE = 24

interface AuthorInfo {
    displayName: string
    avatarUrl: string | null
}

interface ExplorePageClientProps {
    compositions: SongConfig[]
    authorInfo: Record<string, AuthorInfo>
}

// ─── Difficulty config ───────────────────────────────────────────────────────

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
    beginner: 'Beginner',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
}

const DIFFICULTY_COLORS: Record<Difficulty, string> = {
    beginner: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    intermediate: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    advanced: 'bg-red-500/20 text-red-300 border-red-500/30',
}

function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
    return (
        <span className={`absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border backdrop-blur-sm ${DIFFICULTY_COLORS[difficulty]}`}>
            {DIFFICULTY_LABELS[difficulty]}
        </span>
    )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function titleToHue(title: string): number {
    let hash = 0
    for (let i = 0; i < title.length; i++) {
        hash = title.charCodeAt(i) + ((hash << 5) - hash)
    }
    return Math.abs(hash) % 360
}

function formatNumber(n?: number): string {
    if (!n) return '0'
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return String(n)
}

function formatDate(dateStr: string): string {
    try {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        })
    } catch {
        return dateStr
    }
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function ExploreCard({
    config,
    authorInfo,
}: {
    config: SongConfig
    authorInfo?: AuthorInfo
}) {
    const hue = titleToHue(config.title || 'Untitled')
    const hue2 = (hue + 45) % 360
    const hue3 = (hue + 90) % 360

    const initials = authorInfo?.displayName
        .split('-')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase() ?? '??'

    return (
        <Link
            href={`/view/${config.id}`}
            id={`explore-card-${config.id}`}
            className="group relative flex flex-col rounded-xl overflow-hidden border border-zinc-800/60 bg-zinc-900/50 hover:border-zinc-600/50 hover:shadow-xl hover:shadow-purple-500/8 hover:-translate-y-0.5 transition-all duration-300"
        >
            {/* Thumbnail */}
            <div className="relative aspect-[4/3] overflow-hidden bg-zinc-800 shrink-0">
                {config.thumbnail_url ? (
                    <img
                        src={config.thumbnail_url}
                        alt={config.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                ) : (
                    <div
                        className="w-full h-full flex items-center justify-center transition-transform duration-500 group-hover:scale-105"
                        style={{
                            background: `linear-gradient(135deg, hsl(${hue},55%,18%) 0%, hsl(${hue2},45%,14%) 50%, hsl(${hue3},50%,16%) 100%)`,
                        }}
                    >
                        <div className="flex flex-col items-center gap-2 opacity-50 group-hover:opacity-70 transition-opacity duration-300">
                            <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center">
                                <Music className="w-6 h-6 text-white/70" />
                            </div>
                        </div>
                    </div>
                )}

                {/* Difficulty badge */}
                {config.difficulty && <DifficultyBadge difficulty={config.difficulty} />}

                {/* Hover overlay + play button */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 scale-90 group-hover:scale-100">
                    <div className="w-11 h-11 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-lg">
                        <Play className="w-4 h-4 text-white ml-0.5" fill="currentColor" />
                    </div>
                </div>

                {/* View count overlay bottom-right */}
                <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <Eye className="w-3 h-3 text-zinc-300" />
                    <span className="text-xs text-zinc-200 font-mono">{formatNumber(config.view_count)}</span>
                </div>
            </div>

            {/* Card body */}
            <div className="flex flex-col flex-1 px-3 py-3 gap-2">
                <h3 className="text-sm font-semibold text-white leading-snug line-clamp-2 group-hover:text-purple-200 transition-colors duration-200 min-h-[2.5rem]">
                    {config.title || 'Untitled'}
                </h3>

                {/* Author */}
                {authorInfo ? (
                    <div className="flex items-center gap-1.5">
                        {authorInfo.avatarUrl ? (
                            <img
                                src={authorInfo.avatarUrl}
                                alt={authorInfo.displayName}
                                className="w-4 h-4 rounded-full object-cover ring-1 ring-zinc-700 flex-shrink-0"
                            />
                        ) : (
                            <div className="w-4 h-4 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                                <span className="text-[7px] font-bold text-white leading-none">{initials}</span>
                            </div>
                        )}
                        <span className="text-[11px] text-zinc-500 truncate">@{authorInfo.displayName}</span>
                    </div>
                ) : null}

                {/* Stats row */}
                <div className="flex items-center gap-3 mt-auto pt-1 border-t border-zinc-800/60">
                    <div className="flex items-center gap-1 text-zinc-600">
                        <Eye className="w-3 h-3" />
                        <span className="text-[11px] font-mono">{formatNumber(config.view_count)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-zinc-600">
                        <Calendar className="w-3 h-3" />
                        <span className="text-[11px]">{formatDate(config.created_at)}</span>
                    </div>
                </div>
            </div>
        </Link>
    )
}

// ─── Sort + difficulty filter config ─────────────────────────────────────────

const SORT_OPTIONS: { key: SortMode; label: string; icon: React.ReactNode }[] = [
    { key: 'recent',  label: 'Most Recent',  icon: <Clock className="w-3.5 h-3.5" /> },
    { key: 'popular', label: 'Most Viewed',  icon: <TrendingUp className="w-3.5 h-3.5" /> },
    { key: 'az',      label: 'A → Z',        icon: <ArrowUpAZ className="w-3.5 h-3.5" /> },
]

const DIFFICULTY_FILTERS: { key: DifficultyFilter; label: string; color: string }[] = [
    { key: 'all',          label: 'All levels',   color: 'text-zinc-300 border-zinc-700 hover:border-zinc-500' },
    { key: 'beginner',     label: 'Beginner',     color: 'text-emerald-300 border-emerald-500/40 hover:border-emerald-400' },
    { key: 'intermediate', label: 'Intermediate', color: 'text-amber-300 border-amber-500/40 hover:border-amber-400' },
    { key: 'advanced',     label: 'Advanced',     color: 'text-red-300 border-red-500/40 hover:border-red-400' },
]

// ─── Main Page ────────────────────────────────────────────────────────────────

export function ExplorePageClient({ compositions: initial, authorInfo }: ExplorePageClientProps) {
    const [allCompositions, setAllCompositions] = useState<SongConfig[]>(initial)
    const [sortMode, setSortMode] = useState<SortMode>('recent')
    const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>('all')
    const [query, setQuery] = useState('')
    const [sortLoading, setSortLoading] = useState(false)
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

    const handleSort = async (mode: SortMode) => {
        if (mode === sortMode) return
        setSortMode(mode)
        setVisibleCount(PAGE_SIZE) // reset pagination on sort change
        if (mode === 'az') {
            setAllCompositions((prev) => [...prev].sort((a, b) => a.title.localeCompare(b.title)))
            return
        }
        setSortLoading(true)
        try {
            const sorted = await fetchPublishedConfigsSortedAction(mode)
            setAllCompositions(sorted)
        } catch {
            // keep current
        } finally {
            setSortLoading(false)
        }
    }

    const handleDifficultyFilter = (d: DifficultyFilter) => {
        setDifficultyFilter(d)
        setVisibleCount(PAGE_SIZE) // reset pagination on filter change
    }

    const handleSearch = (q: string) => {
        setQuery(q)
        setVisibleCount(PAGE_SIZE) // reset pagination on search change
    }

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        return allCompositions.filter((c) => {
            const matchesQuery = !q ||
                c.title?.toLowerCase().includes(q) ||
                (c.user_id && authorInfo[c.user_id]?.displayName.toLowerCase().includes(q))
            const matchesDifficulty = difficultyFilter === 'all' || c.difficulty === difficultyFilter
            return matchesQuery && matchesDifficulty
        })
    }, [allCompositions, query, authorInfo, difficultyFilter])

    const visible = filtered.slice(0, visibleCount)
    const hasMore = visibleCount < filtered.length

    return (
        <main className="min-h-screen bg-zinc-950 text-white">
            {/* Page header */}
            <div className="border-b border-zinc-800/60 bg-zinc-950">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
                    <h1 className="text-3xl sm:text-4xl font-bold text-white mb-1">
                        Explore Compositions
                    </h1>
                    <p className="text-zinc-500 text-sm">
                        {filtered.length.toLocaleString()} {filtered.length === 1 ? 'composition' : 'compositions'} in the community
                    </p>
                </div>
            </div>

            {/* Sticky filter bar */}
            <div className="sticky top-[57px] z-30 bg-zinc-950/90 backdrop-blur-xl border-b border-zinc-800/50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 space-y-2">
                    {/* Row 1: search + sort */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                        {/* Search */}
                        <div className="relative flex-1 max-w-md w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                            <input
                                type="text"
                                id="explore-search"
                                value={query}
                                onChange={(e) => handleSearch(e.target.value)}
                                placeholder="Search by title or creator..."
                                className="w-full bg-zinc-900 border border-zinc-700/60 rounded-xl pl-9 pr-9 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 transition-all duration-200"
                            />
                            {query && (
                                <button
                                    onClick={() => handleSearch('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>

                        {/* Sort pills */}
                        <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 shrink-0">
                            {SORT_OPTIONS.map((opt) => (
                                <button
                                    key={opt.key}
                                    id={`explore-sort-${opt.key}`}
                                    onClick={() => handleSort(opt.key)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                                        sortMode === opt.key
                                            ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                                            : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                                    }`}
                                >
                                    {opt.icon}
                                    <span className="hidden sm:inline">{opt.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Row 2: difficulty filter pills */}
                    <div className="flex items-center gap-2 flex-wrap">
                        {DIFFICULTY_FILTERS.map((f) => (
                            <button
                                key={f.key}
                                id={`explore-diff-${f.key}`}
                                onClick={() => handleDifficultyFilter(f.key)}
                                className={`px-3 py-1 rounded-full text-xs font-medium border transition-all duration-200 ${
                                    difficultyFilter === f.key
                                        ? `${f.color} bg-white/5`
                                        : 'text-zinc-600 border-zinc-800 hover:text-zinc-400'
                                }`}
                            >
                                {f.label}
                            </button>
                        ))}
                        {difficultyFilter !== 'all' && (
                            <span className="text-xs text-zinc-600">
                                · {filtered.length} result{filtered.length !== 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Grid */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-32 gap-4">
                        <div className="w-20 h-20 rounded-2xl bg-zinc-800/50 flex items-center justify-center">
                            <Music className="w-10 h-10 text-zinc-600" />
                        </div>
                        <p className="text-zinc-400 text-lg font-medium">
                            {query ? `No results for "${query}"` : difficultyFilter !== 'all' ? `No ${difficultyFilter} compositions yet` : 'No compositions yet'}
                        </p>
                        {(query || difficultyFilter !== 'all') && (
                            <button
                                onClick={() => { handleSearch(''); handleDifficultyFilter('all') }}
                                className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
                            >
                                Clear filters
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        <div
                            className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 transition-opacity duration-300 ${
                                sortLoading ? 'opacity-40 pointer-events-none' : 'opacity-100'
                            }`}
                        >
                            {visible.map((config) => (
                                <ExploreCard
                                    key={config.id}
                                    config={config}
                                    authorInfo={config.user_id ? authorInfo[config.user_id] : undefined}
                                />
                            ))}
                        </div>

                        {/* Load More */}
                        {hasMore && (
                            <div className="flex flex-col items-center gap-2 mt-12">
                                <p className="text-xs text-zinc-600">
                                    Showing {visible.length} of {filtered.length}
                                </p>
                                <button
                                    id="explore-load-more"
                                    onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
                                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-sm text-zinc-300 hover:text-white font-medium transition-all duration-200"
                                >
                                    <ChevronDown className="w-4 h-4" />
                                    Load more
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </main>
    )
}
