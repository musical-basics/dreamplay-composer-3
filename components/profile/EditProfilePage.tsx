'use client'

import * as React from 'react'
import { useState, useEffect, useTransition, useRef } from 'react'
import Link from 'next/link'
import { Check, Loader2, ExternalLink, Youtube, Twitter, Instagram, Globe, User, AlertCircle, Save, Camera, Star } from 'lucide-react'
import { getMyProfileAction, updateProfileAction, checkUsernameAvailabilityAction } from '@/app/actions/profile'
import { fetchAllConfigs } from '@/app/actions/config'
import { formatDisplayName } from '@/lib/utils/displayName'
import { useUser } from '@clerk/nextjs'
import { HomeHeader } from '@/components/home/HomeHeader'
import type { SongConfig } from '@/lib/types'

type ProfileData = {
    userId: string
    customUsername: string | null
    displayName: string
    bio: string | null
    twitter_url: string | null
    instagram_url: string | null
    youtube_url: string | null
    website_url: string | null
    avatar_url: string | null
    featured_config_id: string | null
}

export const EditProfilePage: React.FC = () => {
    const { user, isLoaded } = useUser()
    const [profile, setProfile] = useState<ProfileData | null>(null)
    const [loading, setLoading] = useState(true)

    // Form state
    const [username, setUsername] = useState('')
    const [bio, setBio] = useState('')
    const [youtubeUrl, setYoutubeUrl] = useState('')
    const [twitterUrl, setTwitterUrl] = useState('')
    const [instagramUrl, setInstagramUrl] = useState('')
    const [websiteUrl, setWebsiteUrl] = useState('')
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
    const [avatarUploading, setAvatarUploading] = useState(false)
    const avatarInputRef = useRef<HTMLInputElement>(null)

    // Featured composition
    const [featuredConfigId, setFeaturedConfigId] = useState<string | null>(null)
    const [publishedCompositions, setPublishedCompositions] = useState<SongConfig[]>([])

    // Username availability
    const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle')
    const [usernameError, setUsernameError] = useState('')

    // Save state
    const [isPending, startTransition] = useTransition()
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
    const [saveError, setSaveError] = useState('')

    useEffect(() => {
        Promise.all([
            getMyProfileAction(),
            fetchAllConfigs(),
        ]).then(([data, configs]) => {
            if (data) {
                setProfile(data)
                setUsername(data.customUsername ?? '')
                setBio(data.bio ?? '')
                setYoutubeUrl(data.youtube_url ?? '')
                setTwitterUrl(data.twitter_url ?? '')
                setInstagramUrl(data.instagram_url ?? '')
                setWebsiteUrl(data.website_url ?? '')
                setAvatarUrl(data.avatar_url ?? null)
                setFeaturedConfigId(data.featured_config_id ?? null)
            }
            // Only keep published compositions
            setPublishedCompositions(configs.filter((c) => c.is_published))
            setLoading(false)
        })
    }, [])

    // Debounced username availability check
    useEffect(() => {
        if (!profile) return
        const trimmed = username.trim().toLowerCase()

        if (!trimmed || trimmed === (profile.customUsername ?? '').toLowerCase()) {
            setUsernameStatus('idle')
            setUsernameError('')
            return
        }

        if (trimmed.length < 3) {
            setUsernameStatus('error')
            setUsernameError('Must be at least 3 characters')
            return
        }

        if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(trimmed)) {
            setUsernameStatus('error')
            setUsernameError('Only letters, numbers, hyphens. Must start and end with a letter/number.')
            return
        }

        setUsernameStatus('checking')
        const timer = setTimeout(async () => {
            const result = await checkUsernameAvailabilityAction(trimmed)
            if (result.available) {
                setUsernameStatus('available')
                setUsernameError('')
            } else {
                setUsernameStatus('taken')
                setUsernameError('Username already taken')
            }
        }, 500)

        return () => clearTimeout(timer)
    }, [username, profile])

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
        const contentType = file.type || 'image/jpeg'

        setAvatarUploading(true)
        try {
            // Get presigned URL
            const res = await fetch(`/api/avatar-upload?contentType=${encodeURIComponent(contentType)}&ext=${ext}`)
            if (!res.ok) throw new Error('Failed to get upload URL')
            const { presignedUrl, finalFileUrl } = await res.json()

            // Upload to R2
            await fetch(presignedUrl, {
                method: 'PUT',
                headers: { 'Content-Type': contentType },
                body: file,
            })

            // Cache-bust to force reload (R2 same-key update)
            const bustedUrl = `${finalFileUrl}?t=${Date.now()}`
            setAvatarUrl(bustedUrl)

            // Save to profile immediately
            await updateProfileAction({ avatar_url: finalFileUrl })
        } catch (err) {
            console.error('[Avatar] upload failed:', err)
        } finally {
            setAvatarUploading(false)
            e.target.value = ''
        }
    }

    const handleFeaturedChange = async (configId: string | null) => {
        setFeaturedConfigId(configId)
        await updateProfileAction({ featured_config_id: configId })
    }

    const handleSave = () => {
        if (usernameStatus === 'taken' || usernameStatus === 'checking') return

        setSaveStatus('idle')
        setSaveError('')

        startTransition(async () => {
            const result = await updateProfileAction({
                customUsername: username.trim() || null,
                bio: bio.trim() || null,
                youtube_url: youtubeUrl.trim() || null,
                twitter_url: twitterUrl.trim() || null,
                instagram_url: instagramUrl.trim() || null,
                website_url: websiteUrl.trim() || null,
                // avatar is saved immediately on upload — no need to re-send here
            })

            if (result.error) {
                setSaveStatus('error')
                setSaveError(result.error)
            } else {
                setSaveStatus('success')
                setProfile((prev) =>
                    prev
                        ? {
                            ...prev,
                            customUsername: username.trim() || null,
                            displayName: result.displayName ?? prev.displayName,
                            bio: bio.trim() || null,
                            youtube_url: youtubeUrl.trim() || null,
                            twitter_url: twitterUrl.trim() || null,
                            instagram_url: instagramUrl.trim() || null,
                            website_url: websiteUrl.trim() || null,
                        }
                        : prev
                )
                setTimeout(() => setSaveStatus('idle'), 3000)
            }
        })
    }

    const currentDisplayName = profile
        ? formatDisplayName(profile.userId, username.trim() || profile.customUsername)
        : ''

    const publicUrl = profile?.customUsername || username.trim()
        ? `/creator/${username.trim() || profile?.customUsername}`
        : null

    if (loading || !isLoaded) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
            </div>
        )
    }

    const InputField = ({
        label,
        icon: Icon,
        value,
        onChange,
        placeholder,
        hint,
    }: {
        label: string
        icon: React.ElementType
        value: string
        onChange: (v: string) => void
        placeholder?: string
        hint?: string
    }) => (
        <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                <Icon className="w-3.5 h-3.5" />
                {label}
            </label>
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/30 transition-all duration-200"
            />
            {hint && <p className="text-xs text-zinc-600">{hint}</p>}
        </div>
    )

    return (
        <div className="min-h-screen bg-zinc-950 text-white">
            <HomeHeader />

            <div className="max-w-2xl mx-auto px-4 py-12">
                {/* Header */}
                <div className="mb-10">
                    <h1 className="text-2xl font-bold text-white">My Profile</h1>
                    <p className="mt-1.5 text-zinc-500 text-sm">
                        Customize how you appear to other composers and viewers.
                    </p>
                    {publicUrl && (
                        <div className="mt-3">
                            <Link
                                href={publicUrl}
                                target="_blank"
                                className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                            >
                                <ExternalLink className="w-3 h-3" />
                                View public profile
                            </Link>
                        </div>
                    )}
                </div>

                {/* Preview badge */}
                {currentDisplayName && (
                    <div className="mb-8 p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center shadow-lg flex-shrink-0 relative">
                            {avatarUrl ? (
                                <img src={avatarUrl} alt="avatar" className="w-14 h-14 rounded-2xl object-cover" />
                            ) : (
                                <span className="text-xl font-bold text-white">
                                    {currentDisplayName
                                        .split('-')
                                        .map((w: string) => w[0])
                                        .slice(0, 2)
                                        .join('')
                                        .toUpperCase()}
                                </span>
                            )}
                            <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity cursor-pointer rounded-2xl">
                                <input type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} disabled={avatarUploading} />
                                {avatarUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                            </label>
                        </div>
                        <div>
                            <p className="font-semibold text-white">{currentDisplayName}</p>
                            <p className="text-xs text-purple-400 font-mono mt-0.5">
                                @{username.trim() || profile?.customUsername || currentDisplayName}
                            </p>
                            {bio.trim() && (
                                <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{bio.trim()}</p>
                            )}
                        </div>
                    </div>
                )}

                <div className="space-y-6">
                    {/* ── Avatar ── */}
                    <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-4">
                        <h2 className="text-sm font-semibold text-white">Profile Photo</h2>
                        <div className="flex items-center gap-5">
                            {/* Avatar preview */}
                            <div className="relative group/avatar flex-shrink-0">
                                <div className="w-20 h-20 rounded-2xl overflow-hidden bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center shadow-lg">
                                    {avatarUrl ? (
                                        <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                                    ) : (
                                        <span className="text-2xl font-bold text-white">
                                            {currentDisplayName
                                                .split('-')
                                                .map((w: string) => w[0])
                                                .slice(0, 2)
                                                .join('')
                                                .toUpperCase()}
                                        </span>
                                    )}
                                </div>
                                {avatarUploading && (
                                    <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/60">
                                        <Loader2 className="w-6 h-6 animate-spin text-white" />
                                    </div>
                                )}
                            </div>
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-300 text-sm font-medium cursor-pointer hover:border-purple-500/60 hover:text-white transition-all duration-200">
                                    <Camera className="w-4 h-4" />
                                    {avatarUploading ? 'Uploading...' : 'Upload Photo'}
                                    <input
                                        type="file"
                                        className="hidden"
                                        accept="image/jpeg,image/png,image/webp,image/gif"
                                        onChange={handleAvatarUpload}
                                        disabled={avatarUploading}
                                    />
                                </label>
                                <p className="text-xs text-zinc-600">JPG, PNG, WebP or GIF · max 5 MB</p>
                                <p className="text-xs text-zinc-600">Saved instantly on upload</p>
                            </div>
                        </div>
                    </div>

                    {/* ── Username ── */}
                    <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-4">
                        <h2 className="text-sm font-semibold text-white">Username</h2>

                        <div className="space-y-1.5">
                            <label className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                                <User className="w-3.5 h-3.5" />
                                Custom Username
                            </label>
                            <div className="relative">
                                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600 text-sm select-none pointer-events-none">
                                    @
                                </div>
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                                    placeholder="your-username"
                                    maxLength={24}
                                    className="w-full pl-8 pr-10 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/30 transition-all duration-200"
                                />
                                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                    {usernameStatus === 'checking' && (
                                        <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />
                                    )}
                                    {usernameStatus === 'available' && (
                                        <Check className="w-4 h-4 text-emerald-400" />
                                    )}
                                    {(usernameStatus === 'taken' || usernameStatus === 'error') && (
                                        <AlertCircle className="w-4 h-4 text-red-400" />
                                    )}
                                </div>
                            </div>
                            {usernameError && (
                                <p className="text-xs text-red-400">{usernameError}</p>
                            )}
                            {usernameStatus === 'available' && (
                                <p className="text-xs text-emerald-400">Username available!</p>
                            )}
                            <p className="text-xs text-zinc-600">
                                Letters, numbers, and hyphens only · 3–24 characters
                            </p>
                        </div>
                    </div>

                    {/* ── Bio ── */}
                    <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-4">
                        <h2 className="text-sm font-semibold text-white">About</h2>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Bio</label>
                            <textarea
                                value={bio}
                                onChange={(e) => setBio(e.target.value.slice(0, 280))}
                                placeholder="Tell people a bit about yourself and your music..."
                                rows={4}
                                className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/30 transition-all duration-200 resize-none"
                            />
                            <p className="text-xs text-zinc-600 text-right">{bio.length}/280</p>
                        </div>
                    </div>

                    {/* ── Featured Composition ── */}
                    {publishedCompositions.length > 0 && (
                        <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-4">
                            <div className="flex items-center gap-2">
                                <Star className="w-4 h-4 text-amber-400" />
                                <h2 className="text-sm font-semibold text-white">Featured Composition</h2>
                            </div>
                            <p className="text-xs text-zinc-500">
                                Pin one composition to the top of your public profile.
                            </p>
                            <div className="relative">
                                <select
                                    value={featuredConfigId ?? ''}
                                    onChange={(e) => handleFeaturedChange(e.target.value || null)}
                                    className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white appearance-none focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/30 transition-all duration-200 pr-10 cursor-pointer"
                                >
                                    <option value="">— No featured composition —</option>
                                    {publishedCompositions.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.title || 'Untitled'}
                                        </option>
                                    ))}
                                </select>
                                <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                                    <Star className={`w-4 h-4 ${featuredConfigId ? 'text-amber-400' : 'text-zinc-600'}`} />
                                </div>
                            </div>
                            {featuredConfigId && (
                                <p className="text-xs text-amber-400/80 flex items-center gap-1">
                                    <Star className="w-3 h-3" />
                                    Saved — appears pinned at the top of your profile
                                </p>
                            )}
                        </div>
                    )}

                    {/* ── Socials ── */}
                    <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-4">
                        <h2 className="text-sm font-semibold text-white">Social Links</h2>
                        <InputField
                            label="YouTube"
                            icon={Youtube}
                            value={youtubeUrl}
                            onChange={setYoutubeUrl}
                            placeholder="https://youtube.com/@yourhandle"
                        />
                        <InputField
                            label="Twitter / X"
                            icon={Twitter}
                            value={twitterUrl}
                            onChange={setTwitterUrl}
                            placeholder="https://x.com/yourhandle"
                        />
                        <InputField
                            label="Instagram"
                            icon={Instagram}
                            value={instagramUrl}
                            onChange={setInstagramUrl}
                            placeholder="https://instagram.com/yourhandle"
                        />
                        <InputField
                            label="Website"
                            icon={Globe}
                            value={websiteUrl}
                            onChange={setWebsiteUrl}
                            placeholder="https://yourwebsite.com"
                        />
                    </div>

                    {/* ── Save ── */}
                    {saveStatus === 'error' && (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            {saveError}
                        </div>
                    )}

                    <div className="flex items-center justify-between">
                        {saveStatus === 'success' ? (
                            <div className="flex items-center gap-2 text-emerald-400 text-sm">
                                <Check className="w-4 h-4" />
                                Profile saved!
                            </div>
                        ) : (
                            <div />
                        )}
                        <button
                            onClick={handleSave}
                            disabled={isPending || usernameStatus === 'taken' || usernameStatus === 'checking'}
                            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors duration-200 shadow-lg shadow-purple-500/20"
                        >
                            {isPending ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Save className="w-4 h-4" />
                            )}
                            {isPending ? 'Saving...' : 'Save Profile'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
