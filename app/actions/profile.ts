'use server'

import { auth } from '@clerk/nextjs/server'
import { getProfile, upsertProfile, getProfileByUsername } from '@/lib/services/profileService'
import { formatDisplayName } from '@/lib/utils/displayName'

/**
 * Get the current user's profile + resolved display name.
 */
export async function getMyProfileAction(): Promise<{
    userId: string
    customUsername: string | null
    displayName: string
} | null> {
    const { userId } = await auth()
    if (!userId) return null

    const profile = await getProfile(userId)
    return {
        userId,
        customUsername: profile?.custom_username ?? null,
        displayName: formatDisplayName(userId, profile?.custom_username),
    }
}

/**
 * Set or clear the current user's custom username.
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
