'use server'

/**
 * Server Actions for configuration CRUD — auth-free version for Composer-3 testing.
 * Uses a hardcoded test user ID since this repo has no Clerk.
 */

import {
    getAllConfigs,
    getPublishedConfigs,
    getConfigById,
    getPublicConfigById,
    getConfigByIdInternal,
    createConfig,
    updateConfig,
    deleteConfig,
    togglePublish,
    saveAnchors,
    generateUploadUrl,
} from '@/lib/services/configService'
import type { SongConfig, Anchor, BeatAnchor } from '@/lib/types'

const TEST_USER_ID = 'test-user-composer-3'

export async function fetchAllConfigs(): Promise<SongConfig[]> {
    return getAllConfigs(TEST_USER_ID)
}

export async function fetchPublishedConfigs(): Promise<SongConfig[]> {
    return getPublishedConfigs()
}

export async function fetchConfigById(id: string): Promise<SongConfig | null> {
    // Try user-scoped first, fall back to internal (no user filter)
    const config = await getConfigById(id, TEST_USER_ID)
    if (config) return config
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
    return updateConfig(id, updates, TEST_USER_ID)
}

export async function deleteConfigAction(id: string): Promise<void> {
    return deleteConfig(id, TEST_USER_ID)
}

export async function togglePublishAction(id: string, published: boolean): Promise<void> {
    return togglePublish(id, published, TEST_USER_ID)
}

export async function saveAnchorsAction(
    id: string,
    anchors: Anchor[],
    beatAnchors?: BeatAnchor[]
): Promise<void> {
    return saveAnchors(id, anchors, beatAnchors, TEST_USER_ID)
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
    return updateConfig(newConfig.id, {
        audio_url: source.audio_url,
        xml_url: source.xml_url,
        midi_url: source.midi_url,
        anchors: source.anchors,
        beat_anchors: source.beat_anchors,
        subdivision: source.subdivision,
        is_level2: source.is_level2,
        ai_anchors: source.ai_anchors,
    }, TEST_USER_ID)
}
