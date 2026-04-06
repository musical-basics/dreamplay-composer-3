/**
 * Profile Service — reads/writes composer.profiles table.
 * Uses service role key (server-side only).
 */

import { createClient } from '@supabase/supabase-js'

export interface UserProfile {
    user_id: string
    custom_username: string | null
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
 * Get a profile by custom username (for uniqueness checks).
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
 * Create or update the user's custom username.
 * Returns an error string if the username is taken or invalid.
 */
export async function upsertProfile(
    userId: string,
    customUsername: string | null
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
            },
            { onConflict: 'user_id' }
        )

    if (error) {
        console.error('[profileService] upsertProfile error:', error.message)
        return { error: 'Failed to save username. Please try again.' }
    }

    return {}
}
