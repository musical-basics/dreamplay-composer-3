import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { createR2Client, getR2PublicUrl } from '@/lib/r2'
import { getConfigById } from '@/lib/services/configService'
import { updateConfig } from '@/lib/services/configService'

const s3 = createR2Client()

/**
 * POST /api/thumbnail
 *
 * Accepts a PNG blob captured from the client (html2canvas-pro),
 * uploads it to R2, and saves the thumbnail_url on the configuration.
 *
 * Body: raw PNG bytes
 * Headers:
 *   x-config-id: string
 */
export async function POST(req: NextRequest) {
    try {
        const { userId } = await auth()
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const configId = req.headers.get('x-config-id') || ''
        if (!configId) {
            return NextResponse.json({ error: 'x-config-id header is required' }, { status: 400 })
        }

        // Verify ownership
        const config = await getConfigById(configId, userId)
        if (!config) {
            return NextResponse.json({ error: 'Configuration not found' }, { status: 404 })
        }

        const arrayBuffer = await req.arrayBuffer()
        const body = Buffer.from(arrayBuffer)

        if (body.length === 0) {
            return NextResponse.json({ error: 'Empty image body' }, { status: 400 })
        }

        const objectKey = `users/${userId}/configs/${configId}/thumbnail.png`

        await s3.send(new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME!,
            Key: objectKey,
            Body: body,
            ContentType: 'image/png',
            // Cache-busting: allow overwriting
            CacheControl: 'public, max-age=86400',
        }))

        const thumbnailUrl = getR2PublicUrl(objectKey)

        // Save to DB
        await updateConfig(configId, { thumbnail_url: thumbnailUrl } as any, userId)

        console.log('[thumbnail] Saved:', thumbnailUrl)
        return NextResponse.json({ thumbnailUrl })
    } catch (error) {
        console.error('[thumbnail] Failed:', error)
        const message = error instanceof Error ? error.message : 'Failed to save thumbnail'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
