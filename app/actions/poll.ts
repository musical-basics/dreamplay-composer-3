'use server'

import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'

export type PollOptionKey =
    | 'video_export'
    | 'other_instruments'
    | 'longer_videos'
    | 'more_effects'
    | 'something_else'

export interface PollResults {
    counts: Record<PollOptionKey, number>
    userVote: PollOptionKey | null
    total: number
}

const VALID_OPTIONS: PollOptionKey[] = [
    'video_export',
    'other_instruments',
    'longer_videos',
    'more_effects',
    'something_else',
]

function getServiceClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    return createClient(url, key, { db: { schema: 'composer' } })
}

export async function fetchPollResults(): Promise<PollResults> {
    const { userId } = await auth()
    const sb = getServiceClient()

    const { data, error } = await sb
        .from('poll_votes')
        .select('option_key, user_id')

    if (error) {
        console.error('[Poll] fetchPollResults error:', error)
        // Return empty results rather than crashing the page
        return {
            counts: {
                video_export: 0,
                other_instruments: 0,
                longer_videos: 0,
                more_effects: 0,
                something_else: 0,
            },
            userVote: null,
            total: 0,
        }
    }

    const counts: Record<PollOptionKey, number> = {
        video_export: 0,
        other_instruments: 0,
        longer_videos: 0,
        more_effects: 0,
        something_else: 0,
    }

    let userVote: PollOptionKey | null = null

    for (const row of data ?? []) {
        const key = row.option_key as PollOptionKey
        if (key in counts) counts[key]++
        if (userId && row.user_id === userId) userVote = key
    }

    return { counts, userVote, total: data?.length ?? 0 }
}

export async function submitVoteAction(optionKey: PollOptionKey): Promise<PollResults> {
    const { userId } = await auth()
    if (!userId) throw new Error('You must be logged in to vote.')

    if (!VALID_OPTIONS.includes(optionKey)) throw new Error('Invalid option.')

    const sb = getServiceClient()

    const { error } = await sb
        .from('poll_votes')
        .upsert(
            { user_id: userId, option_key: optionKey },
            { onConflict: 'user_id' }
        )

    if (error) throw new Error(`Failed to save vote: ${error.message}`)

    return fetchPollResults()
}
