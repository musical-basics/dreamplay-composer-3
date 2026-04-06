/**
 * captureAndUploadThumbnail
 *
 * Captures a screenshot of a DOM element using html2canvas-pro,
 * uploads the PNG to R2 via /api/thumbnail, and returns the public URL.
 *
 * Used automatically when a composition is first published.
 */

export async function captureAndUploadThumbnail(
    configId: string,
    targetElementId = 'studio-preview'
): Promise<string | null> {
    try {
        const html2canvas = (await import('html2canvas-pro')).default

        const target = document.getElementById(targetElementId)
        if (!target) {
            console.warn('[AutoThumbnail] Target element not found:', targetElementId)
            return null
        }
        // Don't capture if the element is empty (score not loaded yet)
        if (target.offsetWidth === 0 || target.offsetHeight === 0) {
            console.warn('[AutoThumbnail] Target element has no size — score may not be loaded')
            return null
        }

        const canvas = await html2canvas(target as HTMLElement, {
            useCORS: true,
            allowTaint: false,
            scale: 1.5,
            backgroundColor: '#09090b', // zinc-950
            logging: false,
            width: Math.min(target.offsetWidth, 1280),
            height: Math.min(target.offsetHeight, 720),
        })

        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                (b) => b ? resolve(b) : reject(new Error('Canvas to blob failed')),
                'image/png',
                0.9
            )
        })

        const response = await fetch('/api/thumbnail', {
            method: 'POST',
            headers: {
                'Content-Type': 'image/png',
                'x-config-id': configId,
            },
            body: blob,
        })

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: 'Upload failed' }))
            console.warn('[AutoThumbnail] Upload failed:', err)
            return null
        }

        const { thumbnailUrl } = await response.json()
        console.log('[AutoThumbnail] Saved:', thumbnailUrl)
        return thumbnailUrl as string
    } catch (err) {
        // Never block publishing due to thumbnail failure
        console.warn('[AutoThumbnail] Capture failed (non-fatal):', err)
        return null
    }
}
