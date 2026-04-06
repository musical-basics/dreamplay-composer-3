'use client'

import Link from 'next/link'
import { Music } from 'lucide-react'
import type { SongConfig } from '@/lib/types'

interface CompositionCardProps {
    config: SongConfig
}

/**
 * Generates a deterministic hue from a string (title hash).
 * Used for gradient placeholder backgrounds.
 */
function titleToHue(title: string): number {
    let hash = 0
    for (let i = 0; i < title.length; i++) {
        hash = title.charCodeAt(i) + ((hash << 5) - hash)
    }
    return Math.abs(hash) % 360
}

export const CompositionCard: React.FC<CompositionCardProps> = ({ config }) => {
    const hue = titleToHue(config.title || 'Untitled')
    const hue2 = (hue + 40) % 360
    const hue3 = (hue + 80) % 360

    const formatDate = (dateStr: string) => {
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

    return (
        <Link
            href={`/view/${config.id}`}
            id={`composition-card-${config.id}`}
            className="group relative block rounded-2xl overflow-hidden border border-zinc-800/60 bg-zinc-900/50 transition-all duration-300 hover:border-zinc-600/60 hover:shadow-2xl hover:shadow-purple-500/10 hover:-translate-y-1"
        >
            {/* Thumbnail / Gradient Placeholder */}
            <div className="relative aspect-[16/10] overflow-hidden">
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
                            background: `linear-gradient(135deg, hsl(${hue}, 60%, 20%) 0%, hsl(${hue2}, 50%, 15%) 50%, hsl(${hue3}, 55%, 18%) 100%)`,
                        }}
                    >
                        <div className="flex flex-col items-center gap-3 opacity-60 group-hover:opacity-80 transition-opacity duration-300">
                            <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center border border-white/10">
                                <Music className="w-7 h-7 text-white/70" />
                            </div>
                            <span className="text-xs text-white/40 font-medium tracking-wider uppercase">
                                Composition
                            </span>
                        </div>
                    </div>
                )}

                {/* Hover overlay shimmer */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                {/* Play icon on hover */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 scale-90 group-hover:scale-100">
                    <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-lg shadow-black/20">
                        <svg className="w-5 h-5 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    </div>
                </div>
            </div>

            {/* Card Footer */}
            <div className="px-4 py-3">
                <h3 className="text-sm font-semibold text-white truncate group-hover:text-purple-200 transition-colors duration-200">
                    {config.title || 'Untitled'}
                </h3>
                <p className="text-xs text-zinc-500 mt-1">
                    {formatDate(config.updated_at)}
                </p>
            </div>
        </Link>
    )
}
