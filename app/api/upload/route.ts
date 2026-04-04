import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
})

export async function POST(req: NextRequest) {
    try {
        const { configId, filename } = await req.json()

        if (!configId || !filename) {
            return NextResponse.json(
                { error: 'configId and filename are required' },
                { status: 400 }
            )
        }

        const key = `audio/${configId}/${Date.now()}-${filename}`

        const presignedUrl = await getSignedUrl(
            s3,
            new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME!,
                Key: key,
                ContentType: 'audio/wav',
            }),
            { expiresIn: 600 } // 10 minutes
        )

        const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`

        return NextResponse.json({ presignedUrl, publicUrl, key })
    } catch (error) {
        console.error('[upload/route] Failed to generate presigned URL:', error)
        return NextResponse.json(
            { error: 'Failed to generate upload URL' },
            { status: 500 }
        )
    }
}
