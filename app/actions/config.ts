'use server'

/**
 * Server Actions for configuration CRUD — with Clerk auth.
 */

import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'
import {
    getAllConfigs,
    getPublishedConfigs,
    getPublishedConfigsSorted,
    getConfigById,
    getPublicConfigById,
    getConfigByIdInternal,
    createConfig,
    updateConfig,
    updateConfigInternal,
    deleteConfig,
    togglePublish,
    saveAnchors,
    generateUploadUrl,
    saveThumbnail,
} from '@/lib/services/configService'
import type { SongConfig, Anchor, BeatAnchor } from '@/lib/types'

async function getAuthUser() {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    return { id: userId }
}

function getSupabase() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { db: { schema: 'composer' } }
    )
}

export async function fetchAllConfigs(): Promise<SongConfig[]> {
    const user = await getAuthUser()
    return getAllConfigs(user.id)
}

export async function fetchPublishedConfigs(): Promise<SongConfig[]> {
    return getPublishedConfigs()
}

export async function fetchPublishedConfigsSortedAction(
    sort: 'recent' | 'popular'
): Promise<SongConfig[]> {
    return getPublishedConfigsSorted(sort)
}

export async function fetchConfigById(id: string): Promise<SongConfig | null> {
    const { userId } = await auth()
    if (!userId) return getPublicConfigById(id)
    // Admins can access any config regardless of ownership
    const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    if (adminIds.includes(userId)) return getConfigByIdInternal(id)
    return getConfigById(id, userId)
}

export async function fetchConfigByIdInternal(id: string): Promise<SongConfig | null> {
    return getConfigByIdInternal(id)
}

export async function createNewConfig(title?: string): Promise<SongConfig> {
    const user = await getAuthUser()
    return createConfig(title, user.id)
}

export async function updateConfigAction(
    id: string,
    updates: Partial<Pick<SongConfig, 'title' | 'audio_url' | 'xml_url' | 'midi_url' | 'anchors' | 'beat_anchors' | 'subdivision' | 'is_level2' | 'ai_anchors' | 'is_published' | 'music_font'>>
): Promise<SongConfig> {
    const user = await getAuthUser()
    // Admins can update any config regardless of ownership
    const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    if (adminIds.includes(user.id)) return updateConfigInternal(id, updates)
    return updateConfig(id, updates, user.id)
}

export async function deleteConfigAction(id: string): Promise<void> {
    const user = await getAuthUser()
    return deleteConfig(id, user.id)
}

export async function togglePublishAction(id: string, published: boolean): Promise<void> {
    const user = await getAuthUser()
    return togglePublish(id, published, user.id)
}

export async function saveAnchorsAction(
    id: string,
    anchors: Anchor[],
    beatAnchors?: BeatAnchor[]
): Promise<void> {
    const user = await getAuthUser()
    return saveAnchors(id, anchors, beatAnchors, user.id)
}

export async function generateUploadUrlAction(
    configId: string,
    fileType: 'audio' | 'xml' | 'midi',
    fileName: string,
    contentType: string
): Promise<{ uploadUrl: string; finalFileUrl: string }> {
    const user = await getAuthUser()
    return generateUploadUrl(configId, fileType, fileName, contentType, user.id)
}

export async function saveThumbnailAction(
    configId: string,
    thumbnailUrl: string
): Promise<void> {
    const user = await getAuthUser()
    return saveThumbnail(configId, thumbnailUrl, user.id)
}

export async function duplicateConfigAction(
    sourceId: string,
    newTitle: string
): Promise<SongConfig> {
    const user = await getAuthUser()
    const source = await getConfigById(sourceId, user.id)
    if (!source) throw new Error('Source config not found')

    const newConfig = await createConfig(newTitle, user.id)
    return updateConfig(newConfig.id, {
        audio_url: source.audio_url,
        xml_url: source.xml_url,
        midi_url: source.midi_url,
        anchors: source.anchors,
        beat_anchors: source.beat_anchors,
        subdivision: source.subdivision,
        is_level2: source.is_level2,
        ai_anchors: source.ai_anchors,
    }, user.id)
}
