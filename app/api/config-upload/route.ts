import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createR2Client, getR2PublicUrl } from '@/lib/r2'
import { getConfigById } from '@/lib/services/configService'

const s3 = createR2Client()

// -----------------------------------------------------------------------
// GET /api/config-upload?configId=...&fileType=...&fileName=...&contentType=...
// Returns a presigned PUT URL for direct browser-to-R2 upload.
// This bypasses the Next.js 4MB body limit for large audio files.
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

        const ext = originalFileName.split('.').pop() || 'bin'
        let fileKey = ''
        if (fileType === 'audio') fileKey = `audio.${ext}`
        else if (fileType === 'xml') fileKey = 'score.xml'
        else if (fileType === 'midi') fileKey = `midi.${ext}`
        else return NextResponse.json({ error: 'Invalid fileType' }, { status: 400 })

        const objectKey = `users/${userId}/configs/${configId}/${fileKey}`

        const presignedUrl = await getSignedUrl(
            s3,
            new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME!,
                Key: objectKey,
                ContentType: contentType,
            }),
            { expiresIn: 600 } // 10 minutes
        )

        const finalFileUrl = getR2PublicUrl(objectKey)
        console.log('[config-upload] presigned:generated', { objectKey, finalFileUrl })
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
        const contentType = req.headers.get('content-type') ||
            (fileType === 'xml' ? 'application/xml' : fileType === 'midi' ? 'audio/midi' : 'application/octet-stream')

        console.log('[config-upload] request:start', {
            configId,
            fileType,
            originalFileName,
            contentType,
        })

        if (!configId || !fileType) {
            return NextResponse.json({ error: 'x-config-id and x-file-type headers are required' }, { status: 400 })
        }

        const config = await getConfigById(configId, userId)
        if (!config) {
            return NextResponse.json({ error: 'Configuration not found' }, { status: 404 })
        }

        const ext = originalFileName.split('.').pop() || 'bin'
        let fileKey = ''
        if (fileType === 'audio') fileKey = `audio.${ext}`
        else if (fileType === 'xml') fileKey = 'score.xml'
        else if (fileType === 'midi') fileKey = `midi.${ext}`
        else return NextResponse.json({ error: 'Invalid fileType' }, { status: 400 })

        const objectKey = `users/${userId}/configs/${configId}/${fileKey}`
        const arrayBuffer = await req.arrayBuffer()
        const body = Buffer.from(arrayBuffer)

        console.log('[config-upload] request:parsed', {
            objectKey,
            bytes: body.length,
            contentType,
        })

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
        console.log('[config-upload] request:success', { finalFileUrl })
        return NextResponse.json({ finalFileUrl })
    } catch (error) {
        console.error('[config-upload] Failed to upload config asset', error)
        const message = error instanceof Error ? error.message : 'Failed to upload file'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}