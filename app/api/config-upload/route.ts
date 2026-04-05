import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { createR2Client, getR2PublicUrl } from '@/lib/r2'
import { getConfigById } from '@/lib/services/configService'

const s3 = createR2Client()

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