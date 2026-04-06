'use client'

import Link from 'next/link'
import { Sparkles } from 'lucide-react'

interface CTAButtonProps {
    className?: string
}

export const CTAButton: React.FC<CTAButtonProps> = ({ className = '' }) => {
    return (
        <Link
            href="/login"
            id="cta-try-now"
            className={`group relative inline-flex items-center gap-2.5 px-8 py-4 rounded-2xl font-semibold text-white text-base transition-all duration-300 hover:scale-[1.03] active:scale-[0.98] ${className}`}
        >
            {/* Animated gradient background */}
            <span className="absolute inset-0 rounded-2xl bg-gradient-to-r from-purple-600 via-pink-500 to-purple-600 bg-[length:200%_100%] animate-gradient-shift" />

            {/* Glow pulse behind button */}
            <span className="absolute inset-0 rounded-2xl bg-gradient-to-r from-purple-600 via-pink-500 to-purple-600 blur-xl opacity-40 group-hover:opacity-60 transition-opacity duration-300 animate-glow-pulse" />

            {/* Inner border shine */}
            <span className="absolute inset-[1px] rounded-[15px] bg-gradient-to-b from-white/15 to-transparent pointer-events-none" />

            {/* Content */}
            <span className="relative flex items-center gap-2.5">
                <Sparkles className="w-5 h-5 text-yellow-200 group-hover:rotate-12 transition-transform duration-300" />
                <span>Free to use — Try it out now!</span>
            </span>
        </Link>
    )
}
