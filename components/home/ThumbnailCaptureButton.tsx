'use client'

import { useState, useCallback } from 'react'
import { Camera, CheckCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ThumbnailCaptureButtonProps {
    configId: string
    /** The DOM element ID of the container to screenshot (e.g. the score element) */
    targetElementId?: string
    onSuccess?: (thumbnailUrl: string) => void
    className?: string
}

/**
 * Captures a screenshot of the score view using html2canvas-pro,
 * uploads it to R2 via /api/thumbnail, and saves the URL to the DB.
 *
 * Intended for use in the Studio dashboard as a one-click thumbnail generator.
 */
export const ThumbnailCaptureButton: React.FC<ThumbnailCaptureButtonProps> = ({
    configId,
    targetElementId,
    onSuccess,
    className = '',
}) => {
    const [state, setState] = useState<'idle' | 'capturing' | 'uploading' | 'done' | 'error'>('idle')
    const [errorMsg, setErrorMsg] = useState<string | null>(null)

    const handleCapture = useCallback(async () => {
        setState('capturing')
        setErrorMsg(null)

        try {
            // Step 1: Dynamically import html2canvas-pro (avoids SSR issues)
            const html2canvas = (await import('html2canvas-pro')).default

            // Target: the provided element ID, or the full document body
            const target = targetElementId
                ? document.getElementById(targetElementId)
                : document.body

            if (!target) {
                throw new Error('Target element not found')
            }

            const canvas = await html2canvas(target as HTMLElement, {
                useCORS: true,
                allowTaint: false,
                scale: 1.5, // 1.5x for crisp thumbnails
                backgroundColor: '#09090b', // zinc-950
                logging: false,
                width: Math.min(target.offsetWidth, 1280),
                height: Math.min(target.offsetHeight, 720),
            })

            // Step 2: Convert to PNG blob
            setState('uploading')
            const blob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(
                    (b) => b ? resolve(b) : reject(new Error('Canvas to blob failed')),
                    'image/png',
                    0.95
                )
            })

            // Step 3: Upload to R2 via /api/thumbnail
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
                throw new Error(err.error || 'Upload failed')
            }

            const { thumbnailUrl } = await response.json()
            setState('done')
            onSuccess?.(thumbnailUrl)

            // Reset to idle after 2s
            setTimeout(() => setState('idle'), 2000)
        } catch (err) {
            console.error('[ThumbnailCapture] Failed:', err)
            setErrorMsg(err instanceof Error ? err.message : 'Capture failed')
            setState('error')
            setTimeout(() => setState('idle'), 3000)
        }
    }, [configId, targetElementId, onSuccess])

    const label = {
        idle: 'Set Thumbnail',
        capturing: 'Capturing...',
        uploading: 'Uploading...',
        done: 'Saved!',
        error: errorMsg || 'Failed',
    }[state]

    return (
        <Button
            id={`thumbnail-capture-${configId}`}
            variant="ghost"
            size="sm"
            onClick={handleCapture}
            disabled={state === 'capturing' || state === 'uploading'}
            title="Capture current view as thumbnail"
            className={`h-7 gap-1.5 text-xs text-zinc-400 hover:text-purple-300 transition-colors font-outfit ${className}`}
        >
            {state === 'capturing' || state === 'uploading' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : state === 'done' ? (
                <CheckCircle className="w-3.5 h-3.5 text-green-400" />
            ) : (
                <Camera className="w-3.5 h-3.5" />
            )}
            <span className={state === 'error' ? 'text-red-400' : state === 'done' ? 'text-green-400' : ''}>
                {label}
            </span>
        </Button>
    )
}
