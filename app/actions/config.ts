'use server'

/**
 * Server Actions for configuration CRUD — auth-free version for Composer-3 testing.
 * Bypasses user_id filtering since this repo has no Clerk auth.
 */

import { createClient } from '@supabase/supabase-js'
import {
    getAllConfigs,
    getPublishedConfigs,
    getConfigByIdInternal,
    createConfig,
    generateUploadUrl,
} from '@/lib/services/configService'
import type { SongConfig, Anchor, BeatAnchor } from '@/lib/types'

const TEST_USER_ID = 'test-user-composer-3'

function getSupabase() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { db: { schema: 'composer' } }
    )
}

export async function fetchAllConfigs(): Promise<SongConfig[]> {
    return getAllConfigs(TEST_USER_ID)
}

export async function fetchPublishedConfigs(): Promise<SongConfig[]> {
    return getPublishedConfigs()
}

export async function fetchConfigById(id: string): Promise<SongConfig | null> {
    // No user filter — fetch any config by ID
    return getConfigByIdInternal(id)
}

export async function fetchConfigByIdInternal(id: string): Promise<SongConfig | null> {
    return getConfigByIdInternal(id)
}

export async function createNewConfig(title?: string): Promise<SongConfig> {
    return createConfig(title, TEST_USER_ID)
}

export async function updateConfigAction(
    id: string,
    updates: Partial<Pick<SongConfig, 'title' | 'audio_url' | 'xml_url' | 'midi_url' | 'anchors' | 'beat_anchors' | 'subdivision' | 'is_level2' | 'ai_anchors' | 'is_published' | 'music_font'>>
): Promise<SongConfig> {
    // No user_id filter — update any config by ID
    const sb = getSupabase()
    const { data, error } = await sb
        .from('configurations')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

    if (error) throw new Error(`Failed to update config: ${error.message}`)
    return data as SongConfig
}

export async function deleteConfigAction(id: string): Promise<void> {
    const sb = getSupabase()
    const { error } = await sb.from('configurations').delete().eq('id', id)
    if (error) throw new Error(`Failed to delete config: ${error.message}`)
}

export async function togglePublishAction(id: string, published: boolean): Promise<void> {
    const sb = getSupabase()
    const { error } = await sb.from('configurations').update({ is_published: published }).eq('id', id)
    if (error) throw new Error(`Failed to toggle publish: ${error.message}`)
}

export async function saveAnchorsAction(
    id: string,
    anchors: Anchor[],
    beatAnchors?: BeatAnchor[]
): Promise<void> {
    const sb = getSupabase()
    const updates: Record<string, unknown> = { anchors }
    if (beatAnchors !== undefined) updates.beat_anchors = beatAnchors
    const { error } = await sb.from('configurations').update(updates).eq('id', id)
    if (error) throw new Error(`Failed to save anchors: ${error.message}`)
}

export async function generateUploadUrlAction(
    configId: string,
    fileType: 'audio' | 'xml' | 'midi',
    fileName: string,
    contentType: string
): Promise<{ uploadUrl: string; finalFileUrl: string }> {
    return generateUploadUrl(configId, fileType, fileName, contentType, TEST_USER_ID)
}

export async function duplicateConfigAction(
    sourceId: string,
    newTitle: string
): Promise<SongConfig> {
    const source = await getConfigByIdInternal(sourceId)
    if (!source) throw new Error('Source config not found')

    const newConfig = await createConfig(newTitle, TEST_USER_ID)
    const sb = getSupabase()
    const { data, error } = await sb
        .from('configurations')
        .update({
            audio_url: source.audio_url,
            xml_url: source.xml_url,
            midi_url: source.midi_url,
            anchors: source.anchors,
            beat_anchors: source.beat_anchors,
            subdivision: source.subdivision,
            is_level2: source.is_level2,
            ai_anchors: source.ai_anchors,
        })
        .eq('id', newConfig.id)
        .select()
        .single()

    if (error) throw new Error(`Failed to duplicate config: ${error.message}`)
    return data as SongConfig
}
