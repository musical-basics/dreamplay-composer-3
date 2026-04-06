'use client'

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'

interface CreatorChipProps {
    authorName: string
    avatarUrl?: string | null
    compact?: boolean
}

export const CreatorChip: React.FC<CreatorChipProps> = ({ authorName, avatarUrl, compact = false }) => {
    const initials = authorName
        .split('-')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()

    return (
        <Link
            href={`/creator/${authorName}`}
            onClick={(e) => e.stopPropagation()}
            className="group flex items-center gap-1.5 hover:opacity-90 transition-opacity"
            title={`View ${authorName}'s profile`}
        >
            {/* Avatar */}
            {avatarUrl ? (
                <img
                    src={avatarUrl}
                    alt={authorName}
                    className="w-5 h-5 rounded-full object-cover ring-1 ring-zinc-700 flex-shrink-0"
                />
            ) : (
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0 shadow-sm">
                    <span className="text-[8px] font-bold text-white leading-none">{initials}</span>
                </div>
            )}
            <span className="text-zinc-400 text-xs group-hover:text-purple-300 transition-colors duration-200">
                @{authorName}
            </span>
            {!compact && (
                <ExternalLink className="w-2.5 h-2.5 text-zinc-600 group-hover:text-purple-400 transition-colors duration-200 opacity-0 group-hover:opacity-100" />
            )}
        </Link>
    )
}
