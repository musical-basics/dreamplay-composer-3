import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createR2Client, getR2PublicUrl } from '@/lib/r2'
import { getConfigById } from '@/lib/services/configService'

const s3 = createR2Client()

/** Sanitize a filename to be URL-safe while preserving the extension. */
function sanitizeFileName(name: string): string {
    const parts = name.split('.')
    const ext = parts.length > 1 ? parts.pop()! : 'bin'
    const base = parts.join('.')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_+|_+$/g, '')
        || 'score'
    return `${base}.${ext.toLowerCase()}`
}

/** Extract an R2 object key from a public URL. Returns null if not an R2 URL. */
function getKeyFromPublicUrl(url: string): string | null {
    const base = (process.env.R2_PUBLIC_DOMAIN || '').replace(/\/$/, '')
    if (!url.startsWith(base + '/')) return null
    return url.slice(base.length + 1)
}

/** Silently delete an R2 object — logs on failure but never throws. */
async function deleteR2Object(key: string) {
    try {
        await s3.send(new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME!,
            Key: key,
        }))
        console.log('[config-upload] deleted old object:', key)
    } catch (err) {
        console.warn('[config-upload] failed to delete old object:', key, err)
    }
}

// -----------------------------------------------------------------------
// GET /api/config-upload?configId=...&fileType=...&fileName=...&contentType=...
// Returns a presigned PUT URL for direct browser-to-R2 upload.
// Deletes the previous file for the same fileType if one exists.
// -----------------------------------------------------------------------
export async function GET(req: NextRequest) {
    try {
        const { userId } = await auth()
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { searchParams } = new URL(req.url)
        const configId = searchParams.get('configId') || ''
        const fileType = (searchParams.get('fileType') || '') as 'audio' | 'xml' | 'midi'
        const originalFileName = decodeURIComponent(searchParams.get('fileName') || 'upload.bin')
        const contentType = searchParams.get('contentType') || 'application/octet-stream'

        if (!configId || !fileType) {
            return NextResponse.json({ error: 'configId and fileType are required' }, { status: 400 })
        }

        const config = await getConfigById(configId, userId)
        if (!config) {
            return NextResponse.json({ error: 'Configuration not found' }, { status: 404 })
        }

        // Preserve original filename (sanitized) — no more renaming to score.xml
        const fileKey = sanitizeFileName(originalFileName)
        const objectKey = `users/${userId}/configs/${configId}/${fileKey}`

        // Determine the correct content-type regardless of what the browser reports
        const ext = fileKey.split('.').pop()?.toLowerCase() || 'bin'
        const normalizedContentType =
            ext === 'mxl' ? 'application/vnd.recordare.musicxml' :
            (ext === 'xml' || ext === 'musicxml') ? 'application/xml' :
            ext === 'mid' || ext === 'midi' ? 'audio/midi' :
            contentType

        // Delete the previous file for this fileType if one exists
        const oldUrl =
            fileType === 'xml' ? config.xml_url :
            fileType === 'audio' ? config.audio_url :
            fileType === 'midi' ? config.midi_url :
            null
        if (oldUrl) {
            const oldKey = getKeyFromPublicUrl(oldUrl)
            // Only delete if the old key is different (avoid deleting the same file on re-save)
            if (oldKey && oldKey !== objectKey) {
                await deleteR2Object(oldKey)
            }
        }

        const presignedUrl = await getSignedUrl(
            s3,
            new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME!,
                Key: objectKey,
                ContentType: normalizedContentType,
            }),
            { expiresIn: 600 } // 10 minutes
        )

        const finalFileUrl = getR2PublicUrl(objectKey)
        console.log('[config-upload] presigned:generated', { fileKey, objectKey, finalFileUrl })
        return NextResponse.json({ presignedUrl, finalFileUrl })
    } catch (error) {
        console.error('[config-upload] Failed to generate presigned URL', error)
        const message = error instanceof Error ? error.message : 'Failed to generate upload URL'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}

// -----------------------------------------------------------------------
// POST /api/config-upload — kept for small files / backward compat
// -----------------------------------------------------------------------
export async function POST(req: NextRequest) {
    try {
        const { userId } = await auth()
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const configId = req.headers.get('x-config-id') || ''
        const fileType = (req.headers.get('x-file-type') || '') as 'audio' | 'xml' | 'midi'
        const originalFileName = decodeURIComponent(req.headers.get('x-file-name') || 'upload.bin')

        if (!configId || !fileType) {
            return NextResponse.json({ error: 'x-config-id and x-file-type headers are required' }, { status: 400 })
        }

        const config = await getConfigById(configId, userId)
        if (!config) {
            return NextResponse.json({ error: 'Configuration not found' }, { status: 404 })
        }

        const fileKey = sanitizeFileName(originalFileName)
        const ext = fileKey.split('.').pop()?.toLowerCase() || 'bin'
        const contentType =
            ext === 'mxl' ? 'application/vnd.recordare.musicxml' :
            (ext === 'xml' || ext === 'musicxml') ? 'application/xml' :
            ext === 'mid' || ext === 'midi' ? 'audio/midi' :
            req.headers.get('content-type') || 'application/octet-stream'

        const objectKey = `users/${userId}/configs/${configId}/${fileKey}`

        const arrayBuffer = await req.arrayBuffer()
        const body = Buffer.from(arrayBuffer)

        if (body.length === 0) {
            return NextResponse.json({ error: 'Empty upload body' }, { status: 400 })
        }

        await s3.send(new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME!,
            Key: objectKey,
            Body: body,
            ContentType: contentType,
        }))

        const finalFileUrl = getR2PublicUrl(objectKey)
        console.log('[config-upload] POST:success', { finalFileUrl })
        return NextResponse.json({ finalFileUrl })
    } catch (error) {
        console.error('[config-upload] Failed to upload config asset', error)
        const message = error instanceof Error ? error.message : 'Failed to upload file'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}