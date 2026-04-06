'use client'

import * as React from 'react'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Youtube, Twitter, Instagram, Globe, Music, Eye, Share2, Check } from 'lucide-react'
import { CompositionCard } from '@/components/home/CompositionCard'
import type { UserProfile } from '@/lib/services/profileService'
import type { SongConfig } from '@/lib/types'

interface CreatorProfilePageProps {
    profile: UserProfile
    displayName: string
    compositions: SongConfig[]
}

export const CreatorProfilePage: React.FC<CreatorProfilePageProps> = ({
    profile,
    displayName,
    compositions,
}) => {
    const [copied, setCopied] = useState(false)

    const initials = displayName
        .split('-')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()

    const totalViews = compositions.reduce((sum, c) => sum + (c.view_count ?? 0), 0)

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(window.location.href)
            setCopied(true)
            setTimeout(() => setCopied(false), 2500)
        } catch {
            // Fallback for older browsers
            const input = document.createElement('input')
            input.value = window.location.href
            document.body.appendChild(input)
            input.select()
            document.execCommand('copy')
            document.body.removeChild(input)
            setCopied(true)
            setTimeout(() => setCopied(false), 2500)
        }
    }

    const socialLinks = [
        profile.youtube_url && {
            href: profile.youtube_url,
            icon: Youtube,
            label: 'YouTube',
            color: 'hover:text-red-400 hover:border-red-400/40',
        },
        profile.twitter_url && {
            href: profile.twitter_url,
            icon: Twitter,
            label: 'Twitter / X',
            color: 'hover:text-sky-400 hover:border-sky-400/40',
        },
        profile.instagram_url && {
            href: profile.instagram_url,
            icon: Instagram,
            label: 'Instagram',
            color: 'hover:text-pink-400 hover:border-pink-400/40',
        },
        profile.website_url && {
            href: profile.website_url,
            icon: Globe,
            label: 'Website',
            color: 'hover:text-emerald-400 hover:border-emerald-400/40',
        },
    ].filter(Boolean) as { href: string; icon: React.ElementType; label: string; color: string }[]

    return (
        <div className="min-h-screen bg-zinc-950 text-white">
            {/* Top nav */}
            <div className="sticky top-0 z-10 px-4 py-3 bg-zinc-950/80 backdrop-blur-lg border-b border-zinc-800/60">
                <div className="max-w-5xl mx-auto flex items-center justify-between">
                    <Link
                        href="/"
                        className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span>Gallery</span>
                    </Link>
                    <div className="flex items-center gap-3">
                        {/* Share button */}
                        <button
                            onClick={handleCopyLink}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200 ${
                                copied
                                    ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                                    : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white bg-zinc-900/60'
                            }`}
                        >
                            {copied ? (
                                <>
                                    <Check className="w-3.5 h-3.5" />
                                    Link copied!
                                </>
                            ) : (
                                <>
                                    <Share2 className="w-3.5 h-3.5" />
                                    Share profile
                                </>
                            )}
                        </button>
                        <div className="flex items-center gap-2">
                            <Music className="w-4 h-4 text-purple-400" />
                            <span className="text-xs text-zinc-500">DreamPlay Composer</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-4 py-12">
                {/* ── Hero ── */}
                <div className="relative mb-12">
                    {/* Background glow */}
                    <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

                    <div className="relative flex flex-col items-center text-center gap-6">
                        {/* Avatar */}
                        <div className="relative">
                            {profile.avatar_url ? (
                                <div className="relative w-24 h-24">
                                    <img
                                        src={profile.avatar_url}
                                        alt={displayName}
                                        className="w-24 h-24 rounded-3xl object-cover shadow-2xl shadow-purple-500/20 ring-4 ring-zinc-900"
                                    />
                                </div>
                            ) : (
                                <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center shadow-2xl shadow-purple-500/30 ring-4 ring-zinc-900">
                                    <span className="text-3xl font-bold text-white">{initials}</span>
                                </div>
                            )}
                            <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                                <Music className="w-3.5 h-3.5 text-purple-400" />
                            </div>
                        </div>

                        {/* Name & handle */}
                        <div>
                            <h1 className="text-3xl font-bold text-white tracking-tight">
                                {displayName}
                            </h1>
                            <p className="mt-1 text-purple-400 font-mono text-sm">@{profile.custom_username ?? displayName}</p>
                        </div>

                        {/* Bio */}
                        {profile.bio && (
                            <p className="max-w-md text-zinc-300 text-sm leading-relaxed">
                                {profile.bio}
                            </p>
                        )}

                        {/* Stats */}
                        <div className="flex items-center gap-6">
                            <div className="flex flex-col items-center">
                                <span className="text-xl font-bold text-white">{compositions.length}</span>
                                <span className="text-xs text-zinc-500 mt-0.5">
                                    {compositions.length === 1 ? 'Composition' : 'Compositions'}
                                </span>
                            </div>
                            {totalViews > 0 && (
                                <>
                                    <div className="w-px h-8 bg-zinc-800" />
                                    <div className="flex flex-col items-center">
                                        <span className="text-xl font-bold text-white">
                                            {totalViews >= 1000
                                                ? `${(totalViews / 1000).toFixed(1)}k`
                                                : totalViews}
                                        </span>
                                        <span className="text-xs text-zinc-500 mt-0.5">Total Views</span>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Social links */}
                        {socialLinks.length > 0 && (
                            <div className="flex items-center gap-2 flex-wrap justify-center">
                                {socialLinks.map(({ href, icon: Icon, label, color }) => (
                                    <a
                                        key={label}
                                        href={href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title={label}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-800 bg-zinc-900/60 text-zinc-400 text-sm transition-all duration-200 ${color} hover:bg-zinc-800/60`}
                                    >
                                        <Icon className="w-4 h-4" />
                                        <span>{label}</span>
                                    </a>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Compositions ── */}
                <div>
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-lg font-semibold text-white">
                            {compositions.length > 0 ? 'Recent Compositions' : 'No compositions yet'}
                        </h2>
                        {compositions.length > 0 && (
                            <span className="text-xs text-zinc-500 flex items-center gap-1">
                                <Eye className="w-3.5 h-3.5" />
                                {compositions.length} published
                            </span>
                        )}
                    </div>

                    {compositions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center border border-dashed border-zinc-800 rounded-2xl">
                            <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center">
                                <Music className="w-8 h-8 text-zinc-600" />
                            </div>
                            <div>
                                <p className="text-zinc-400 font-medium">Nothing published yet</p>
                                <p className="text-zinc-600 text-sm mt-1">Check back soon</p>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                            {compositions.map((config) => (
                                <CompositionCard key={config.id} config={config} />
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer CTA */}
                <div className="mt-16 text-center">
                    <p className="text-zinc-600 text-sm mb-3">Create your own composition visualizer</p>
                    <Link
                        href="/login"
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors duration-200 shadow-lg shadow-purple-500/20"
                    >
                        <Music className="w-4 h-4" />
                        Get Started Free
                    </Link>
                </div>
            </div>
        </div>
    )
}
