'use client'

import { useState } from 'react'
import { Play, ArrowRight } from 'lucide-react'
import Link from 'next/link'

const VIDEO_ID = 'kTDFXZibG_M'
const THUMBNAIL_URL = `https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg`

export function HeroVideo() {
    const [playing, setPlaying] = useState(false)

    return (
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pb-12 sm:pb-16">
            {/* Outer glow ring */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[110%] h-[110%] rounded-3xl bg-purple-500/10 blur-3xl" />
            </div>

            {/* ── Eyebrow label ── */}
            <div className="text-center mb-6">
                <div className="inline-block">
                    <p className="text-sm sm:text-base font-semibold tracking-widest uppercase text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400">
                        See it in action
                    </p>
                    {/* Gradient underline */}
                    <div className="mt-1.5 h-px w-full bg-gradient-to-r from-transparent via-pink-500/60 to-transparent" />
                </div>
            </div>

            {/* ── Video ── */}
            <div
                className="relative rounded-2xl overflow-hidden border border-white/10 shadow-[0_0_80px_-10px_rgba(168,85,247,0.35)] group cursor-pointer"
                style={{ aspectRatio: '16/9' }}
                onClick={() => !playing && setPlaying(true)}
                role="button"
                aria-label="Play product introduction video"
                tabIndex={0}
                onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !playing) setPlaying(true)
                }}
            >
                {playing ? (
                    /* YouTube iframe — autoplay=1 starts immediately */
                    <iframe
                        className="absolute inset-0 w-full h-full"
                        src={`https://www.youtube.com/embed/${VIDEO_ID}?autoplay=1&rel=0&modestbranding=1&color=white`}
                        title="DreamPlay Composer — Product Introduction"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                    />
                ) : (
                    <>
                        {/* Thumbnail */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={THUMBNAIL_URL}
                            alt="DreamPlay Composer product introduction thumbnail"
                            className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                            loading="lazy"
                        />

                        {/* Dark overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-black/10 group-hover:from-black/50 transition-all duration-300" />

                        {/* Play button */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                            <div className="relative flex items-center justify-center">
                                {/* Pulsing ring */}
                                <span className="absolute w-24 h-24 rounded-full bg-white/10 animate-ping" />
                                <span className="absolute w-20 h-20 rounded-full bg-white/15" />
                                {/* Button */}
                                <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white flex items-center justify-center shadow-2xl transition-transform duration-300 group-hover:scale-110">
                                    <Play className="w-7 h-7 sm:w-9 sm:h-9 text-purple-700 fill-purple-700 ml-1" />
                                </div>
                            </div>

                            <p className="text-white/80 text-sm sm:text-base font-medium tracking-wide drop-shadow-lg">
                                Watch the intro — 3 min
                            </p>
                        </div>
                    </>
                )}
            </div>

            {/* ── Mobile CTA — shown on mobile, hidden sm+ ── */}
            <div className="mt-6 flex justify-center sm:hidden">
                <Link
                    href="/login"
                    id="hero-video-mobile-cta"
                    className="group inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-purple-500/30 bg-purple-500/10 text-purple-300 text-sm font-semibold tracking-wide hover:bg-purple-500/20 hover:border-purple-400/50 hover:text-purple-200 transition-all duration-200"
                >
                    Try it free
                    <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
            </div>
        </div>
    )
}
