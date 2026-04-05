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

        const formData = await req.formData()
        const configId = String(formData.get('configId') || '')
        const fileType = String(formData.get('fileType') || '') as 'audio' | 'xml' | 'midi'
        const file = formData.get('file')

        if (!configId || !fileType || !(file instanceof File)) {
            return NextResponse.json({ error: 'configId, fileType, and file are required' }, { status: 400 })
        }

        const config = await getConfigById(configId, userId)
        if (!config) {
            return NextResponse.json({ error: 'Configuration not found' }, { status: 404 })
        }

        const ext = file.name.split('.').pop() || 'bin'
        let fileKey = ''
        if (fileType === 'audio') fileKey = `audio.${ext}`
        else if (fileType === 'xml') fileKey = 'score.xml'
        else if (fileType === 'midi') fileKey = `midi.${ext}`
        else return NextResponse.json({ error: 'Invalid fileType' }, { status: 400 })

        const objectKey = `users/${userId}/configs/${configId}/${fileKey}`
        const body = Buffer.from(await file.arrayBuffer())
        const contentType = file.type ||
            (fileType === 'xml' ? 'application/xml' : fileType === 'midi' ? 'audio/midi' : 'application/octet-stream')

        await s3.send(new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME!,
            Key: objectKey,
            Body: body,
            ContentType: contentType,
        }))

        return NextResponse.json({ finalFileUrl: getR2PublicUrl(objectKey) })
    } catch (error) {
        console.error('[config-upload] Failed to upload config asset', error)
        const message = error instanceof Error ? error.message : 'Failed to upload file'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}