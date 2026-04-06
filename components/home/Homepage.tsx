'use client'

import { useState, useCallback } from 'react'
import { LayoutGrid, Music, Clock, TrendingUp } from 'lucide-react'
import { HomeHeader } from './HomeHeader'
import { CompositionCard } from './CompositionCard'
import { CTAButton } from './CTAButton'
import { fetchPublishedConfigsSortedAction } from '@/app/actions/config'
import { FeaturePoll } from './FeaturePoll'
import type { PollResults } from '@/app/actions/poll'
import type { SongConfig } from '@/lib/types'

interface HomepageProps {
    compositions: SongConfig[]
    pollResults: PollResults
}

const COLUMN_OPTIONS = [2, 3, 4] as const
type SortMode = 'recent' | 'popular'

/**
 * Responsive grid classes by desktop column count.
 * Always: 1 col mobile, 2 col tablet (sm), N col desktop (md+).
 */
const GRID_CLASSES: Record<number, string> = {
    2: 'grid grid-cols-1 sm:grid-cols-2',
    3: 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3',
    4: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
}

export const Homepage: React.FC<HomepageProps> = ({ compositions: initial, pollResults }) => {
    const [columns, setColumns] = useState<number>(3)
    const [sortMode, setSortMode] = useState<SortMode>('recent')
    const [compositions, setCompositions] = useState<SongConfig[]>(initial)
    const [sortLoading, setSortLoading] = useState(false)

    const handleSortChange = useCallback(async (mode: SortMode) => {
        if (mode === sortMode) return
        setSortMode(mode)
        setSortLoading(true)
        try {
            const sorted = await fetchPublishedConfigsSortedAction(mode)
            setCompositions(sorted)
        } catch {
            // fallback — keep current order
        } finally {
            setSortLoading(false)
        }
    }, [sortMode])

    return (
        <div className="min-h-screen bg-zinc-950 text-white">
            <HomeHeader />

            {/* Hero Section */}
            <section className="relative overflow-hidden">
                {/* Background glow */}
                <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-purple-500/8 rounded-full blur-[120px]" />
                    <div className="absolute top-20 left-1/4 w-[300px] h-[300px] bg-pink-500/5 rounded-full blur-[100px]" />
                    <div className="absolute top-10 right-1/4 w-[250px] h-[250px] bg-blue-500/5 rounded-full blur-[80px]" />
                </div>

                <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-10 sm:pb-12 text-center">
                    {/* Badge */}
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 mb-6">
                        <Music className="w-3.5 h-3.5 text-purple-400" />
                        <span className="text-xs font-medium text-purple-300 tracking-wide">
                            World&apos;s First Auto-Mapping Visualizer
                        </span>
                    </div>

                    <h1 className="text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight leading-[1.1] mb-4">
                        <span className="text-white">See Music </span>
                        <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 bg-clip-text text-transparent">
                            Come Alive
                        </span>
                    </h1>

                    <p className="text-base sm:text-lg text-zinc-400 max-w-2xl mx-auto mb-8 leading-relaxed px-4">
                        DreamPlay Composer auto-maps your performance to sheet music in real time.
                        Watch notes light up, fall, and dance — the ultimate visualization tool
                        for pianists and composers.
                    </p>

                    <CTAButton className="mx-auto" />
                </div>
            </section>

            {/* Feature Poll */}
            <FeaturePoll initialResults={pollResults} />

            {/* Community Grid Section */}
            <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-20">
                {/* Section Header + Controls */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                    <div>
                        <h2 className="text-xl sm:text-2xl font-bold text-white">Community Creations</h2>
                        <p className="text-sm text-zinc-500 mt-1">
                            Explore what the community has been creating
                        </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Sort Toggle */}
                        <div className="flex items-center gap-1 bg-zinc-900/60 border border-zinc-800 rounded-xl p-1">
                            <button
                                id="sort-recent"
                                onClick={() => handleSortChange('recent')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                                    sortMode === 'recent'
                                        ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                                        : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                                }`}
                            >
                                <Clock className="w-3 h-3" />
                                Recent
                            </button>
                            <button
                                id="sort-popular"
                                onClick={() => handleSortChange('popular')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                                    sortMode === 'popular'
                                        ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                                        : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                                }`}
                            >
                                <TrendingUp className="w-3 h-3" />
                                Most Viewed
                            </button>
                        </div>

                        {/* Column Toggle — hidden on mobile, shown md+ */}
                        <div className="hidden md:flex items-center gap-1 bg-zinc-900/60 border border-zinc-800 rounded-xl p-1">
                            {COLUMN_OPTIONS.map((col) => (
                                <button
                                    key={col}
                                    id={`grid-col-${col}`}
                                    onClick={() => setColumns(col)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                                        columns === col
                                            ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                                            : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                                    }`}
                                >
                                    <LayoutGrid className="w-3 h-3" />
                                    {col}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Grid */}
                {compositions.length === 0 ? (
                    <div className="text-center py-24 space-y-4">
                        <div className="w-20 h-20 mx-auto rounded-2xl bg-zinc-800/50 flex items-center justify-center">
                            <Music className="w-10 h-10 text-zinc-600" />
                        </div>
                        <p className="text-zinc-400 text-lg font-medium">No compositions published yet</p>
                        <p className="text-zinc-600 text-sm">Be the first to share your creation!</p>
                    </div>
                ) : (
                    <div
                        className={`${GRID_CLASSES[columns]} gap-4 sm:gap-5 transition-opacity duration-300 ${sortLoading ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}
                    >
                        {compositions.map((config) => (
                            <CompositionCard key={config.id} config={config} />
                        ))}
                    </div>
                )}

                {/* Bottom CTA */}
                {compositions.length > 0 && (
                    <div className="mt-16 text-center">
                        <p className="text-zinc-500 text-sm mb-4">
                            Want to create your own visualizations?
                        </p>
                        <CTAButton />
                    </div>
                )}
            </section>
        </div>
    )
}
