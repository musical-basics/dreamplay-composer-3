import { NextRequest, NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createR2Client, getR2PublicUrl } from '@/lib/r2'

const s3 = createR2Client()

export async function POST(req: NextRequest) {
    try {
        const { configId, filename } = await req.json()

        if (!configId || !filename) {
            return NextResponse.json(
                { error: 'configId and filename are required' },
                { status: 400 }
            )
        }

        const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '-')
        const key = `audio/${configId}/${Date.now()}-${safeFilename}`

        const presignedUrl = await getSignedUrl(
            s3,
            new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME!,
                Key: key,
                ContentType: 'audio/wav',
            }),
            { expiresIn: 600 } // 10 minutes
        )

        const publicUrl = getR2PublicUrl(key)

        return NextResponse.json({ presignedUrl, publicUrl, key })
    } catch (error) {
        console.error('[upload/route] Failed to generate presigned URL:', error)
        return NextResponse.json(
            { error: 'Failed to generate upload URL' },
            { status: 500 }
        )
    }
}
