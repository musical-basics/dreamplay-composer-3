import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createR2Client, getR2PublicUrl } from '@/lib/r2'

const s3 = createR2Client()

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB

/**
 * GET /api/avatar-upload?contentType=image/jpeg&ext=jpg
 * Returns a presigned PUT URL for direct browser→R2 avatar upload.
 */
export async function GET(req: NextRequest) {
    try {
        const { userId } = await auth()
        if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { searchParams } = new URL(req.url)
        const contentType = searchParams.get('contentType') || 'image/jpeg'
        const ext = searchParams.get('ext') || 'jpg'

        if (!ALLOWED_TYPES.includes(contentType)) {
            return NextResponse.json({ error: 'Invalid image type. Use JPEG, PNG, WebP, or GIF.' }, { status: 400 })
        }

        const objectKey = `users/${userId}/avatar/avatar.${ext}`

        const presignedUrl = await getSignedUrl(
            s3,
            new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME!,
                Key: objectKey,
                ContentType: contentType,
            }),
            { expiresIn: 600 }
        )

        const finalFileUrl = getR2PublicUrl(objectKey)
        return NextResponse.json({ presignedUrl, finalFileUrl })
    } catch (error) {
        console.error('[avatar-upload] error:', error)
        return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 })
    }
}
