/**
 * Profile Service — reads/writes composer.profiles table.
 * Uses service role key (server-side only).
 */

import { createClient } from '@supabase/supabase-js'
import type { SongConfig } from '@/lib/types'

export interface UserProfile {
    user_id: string
    custom_username: string | null
    bio: string | null
    twitter_url: string | null
    instagram_url: string | null
    youtube_url: string | null
    website_url: string | null
    avatar_url: string | null
    featured_config_id: string | null
    created_at: string
    updated_at: string
}

function getSupabase() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    return createClient(url, key, { db: { schema: 'composer' } })
}

/**
 * Get a user's profile. Returns null if no profile row exists yet.
 */
export async function getProfile(userId: string): Promise<UserProfile | null> {
    const sb = getSupabase()
    const { data, error } = await sb
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single()

    if (error) {
        if (error.code === 'PGRST116') return null // no rows — expected
        console.error('[profileService] getProfile error:', error.message)
        return null
    }
    return data as UserProfile
}

/**
 * Get a profile by custom username (for uniqueness checks and public pages).
 */
export async function getProfileByUsername(username: string): Promise<UserProfile | null> {
    const sb = getSupabase()
    const { data, error } = await sb
        .from('profiles')
        .select('*')
        .eq('custom_username', username.toLowerCase().trim())
        .single()

    if (error) return null
    return data as UserProfile
}

/**
 * Create or update the user's profile fields.
 * Returns an error string if the username is taken or invalid.
 */
export async function upsertProfile(
    userId: string,
    customUsername: string | null,
    extras?: {
        bio?: string | null
        twitter_url?: string | null
        instagram_url?: string | null
        youtube_url?: string | null
        website_url?: string | null
        avatar_url?: string | null
        featured_config_id?: string | null
    }
): Promise<{ error?: string }> {
    if (customUsername !== null) {
        const trimmed = customUsername.toLowerCase().trim()

        // Validate: 3–24 chars, only letters/numbers/hyphens, no leading/trailing hyphens
        if (!/^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$/.test(trimmed) && trimmed.length < 3) {
            return { error: 'Username must be 3–24 characters (letters, numbers, hyphens only).' }
        }
        if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(trimmed)) {
            return { error: 'Username must start and end with a letter or number.' }
        }

        // Uniqueness check (exclude own row)
        const existing = await getProfileByUsername(trimmed)
        if (existing && existing.user_id !== userId) {
            return { error: 'That username is already taken.' }
        }
    }

    const sb = getSupabase()
    const { error } = await sb
        .from('profiles')
        .upsert(
            {
                user_id: userId,
                custom_username: customUsername ? customUsername.toLowerCase().trim() : null,
                updated_at: new Date().toISOString(),
                ...extras,
            },
            { onConflict: 'user_id' }
        )

    if (error) {
        console.error('[profileService] upsertProfile error:', error.message)
        return { error: 'Failed to save profile. Please try again.' }
    }

    return {}
}

/**
 * Get up to `limit` published compositions for a given userId.
 */
export async function getPublishedConfigsByUserId(
    userId: string,
    limit = 10
): Promise<SongConfig[]> {
    const sb = getSupabase()
    const { data, error } = await sb
        .from('configurations')
        .select('*')
        .eq('user_id', userId)
        .eq('is_published', true)
        .order('updated_at', { ascending: false })
        .limit(limit)

    if (error) {
        console.error('[profileService] getPublishedConfigsByUserId error:', error.message)
        return []
    }
    return (data || []) as SongConfig[]
}

/**
 * Batch-fetch profiles for a list of userIds. Returns a map of userId → UserProfile.
 * Missing userIds simply won't have an entry in the map.
 */
export async function getProfilesByUserIds(
    userIds: string[]
): Promise<Map<string, UserProfile>> {
    if (userIds.length === 0) return new Map()

    const sb = getSupabase()
    const { data, error } = await sb
        .from('profiles')
        .select('*')
        .in('user_id', userIds)

    if (error) {
        console.error('[profileService] getProfilesByUserIds error:', error.message)
        return new Map()
    }

    const map = new Map<string, UserProfile>()
    for (const row of data || []) {
        map.set(row.user_id, row as UserProfile)
    }
    return map
}
