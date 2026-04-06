'use server'

import { auth } from '@clerk/nextjs/server'
import { getProfile, upsertProfile, getProfileByUsername, getPublishedConfigsByUserId } from '@/lib/services/profileService'
import { formatDisplayName, generateDisplayName } from '@/lib/utils/displayName'
import type { UserProfile } from '@/lib/services/profileService'
import type { SongConfig } from '@/lib/types'

/**
 * Get the current user's full profile + resolved display name.
 */
export async function getMyProfileAction(): Promise<{
    userId: string
    customUsername: string | null
    displayName: string
    bio: string | null
    twitter_url: string | null
    instagram_url: string | null
    youtube_url: string | null
    website_url: string | null
    avatar_url: string | null
} | null> {
    const { userId } = await auth()
    if (!userId) return null

    const profile = await getProfile(userId)
    return {
        userId,
        customUsername: profile?.custom_username ?? null,
        displayName: formatDisplayName(userId, profile?.custom_username),
        bio: profile?.bio ?? null,
        twitter_url: profile?.twitter_url ?? null,
        instagram_url: profile?.instagram_url ?? null,
        youtube_url: profile?.youtube_url ?? null,
        website_url: profile?.website_url ?? null,
        avatar_url: profile?.avatar_url ?? null,
    }
}

/**
 * Update the current user's profile (username + bio + socials in one call).
 */
export async function updateProfileAction(fields: {
    customUsername?: string | null
    bio?: string | null
    twitter_url?: string | null
    instagram_url?: string | null
    youtube_url?: string | null
    website_url?: string | null
    avatar_url?: string | null
}): Promise<{ error?: string; displayName?: string }> {
    const { userId } = await auth()
    if (!userId) return { error: 'Not authenticated' }

    const result = await upsertProfile(
        userId,
        fields.customUsername !== undefined ? fields.customUsername : null,
        {
            bio: fields.bio,
            twitter_url: fields.twitter_url,
            instagram_url: fields.instagram_url,
            youtube_url: fields.youtube_url,
            website_url: fields.website_url,
            avatar_url: fields.avatar_url,
        }
    )
    if (result.error) return { error: result.error }

    return {
        displayName: formatDisplayName(userId, fields.customUsername ?? null),
    }
}

/**
 * Set or clear the current user's custom username (legacy — kept for compat).
 */
export async function setUsernameAction(
    customUsername: string | null
): Promise<{ error?: string; displayName?: string }> {
    const { userId } = await auth()
    if (!userId) return { error: 'Not authenticated' }

    const result = await upsertProfile(userId, customUsername)
    if (result.error) return { error: result.error }

    return {
        displayName: formatDisplayName(userId, customUsername),
    }
}

/**
 * Get display name for any userId (used by viewer page to show author).
 */
export async function getAuthorDisplayNameAction(userId: string): Promise<string> {
    const profile = await getProfile(userId)
    return formatDisplayName(userId, profile?.custom_username)
}

/**
 * Check if a username is available.
 */
export async function checkUsernameAvailabilityAction(
    username: string
): Promise<{ available: boolean; error?: string }> {
    const { userId } = await auth()
    if (!userId) return { available: false, error: 'Not authenticated' }

    const existing = await getProfileByUsername(username)
    if (!existing || existing.user_id === userId) {
        return { available: true }
    }
    return { available: false }
}

/**
 * Get a creator's full public profile + recent published compositions.
 * Resolves by custom_username first, then by generated display name.
 */
export async function getCreatorProfileAction(username: string): Promise<{
    profile: UserProfile | null
    userId: string | null
    displayName: string
    compositions: SongConfig[]
} | null> {
    // Try by custom_username first
    let profile = await getProfileByUsername(username)
    let userId: string | null = profile?.user_id ?? null

    // If not found by custom username, check if it matches a generated display name
    // (This allows /creator/happy-otter-214 style URLs even without a custom username)
    if (!profile) {
        // We can't reverse-lookup by generated name efficiently without scanning all users,
        // so we return null for generated names that don't match a custom username.
        // Users without a custom username can set one to claim their profile URL.
        return null
    }

    const compositions = userId ? await getPublishedConfigsByUserId(userId, 10) : []
    const displayName = formatDisplayName(userId ?? '', profile?.custom_username)

    return { profile, userId, displayName, compositions }
}
