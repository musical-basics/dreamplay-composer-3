'use client'

import * as React from 'react'
import { useEffect, useRef, useState, useCallback } from 'react'
import { OpenSheetMusicDisplay as OSMD } from 'opensheetmusicdisplay'

interface UseOSMDOptions {
    autoResize?: boolean
    drawTitle?: boolean
    drawSubtitle?: boolean
}

export function useOSMD(
    containerRef: React.RefObject<HTMLDivElement | null>,
    xmlUrl: string | null,
    options: UseOSMDOptions = {}
) {
    const osmdRef = useRef<OSMD | null>(null)
    const [isLoaded, setIsLoaded] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [totalMeasures, setTotalMeasures] = useState(0)

    const {
        autoResize = true,
        drawTitle = false,
        drawSubtitle = false,
    } = options

    const loadScore = useCallback(async (url: string) => {
        if (!containerRef.current) return

        try {
            setIsLoaded(false)
            setError(null)

            // Clean up previous instance
            if (osmdRef.current) {
                osmdRef.current.clear()
            }

            const osmd = new OSMD(containerRef.current, {
                autoResize,
                drawTitle,
                drawSubtitle,
                drawPartNames: false,
                drawPartAbbreviations: false,
                drawFingerings: false,
                drawCredits: false,
                drawComposer: false,
                drawLyricist: false,
                backend: 'svg',
                renderSingleHorizontalStaffline: true,
            })

            // Fetch the file ourselves to detect format by content,
            // since MXL files may be stored with a .xml extension.
            console.log('[OSMD] Fetching score from URL:', url)
            const response = await fetch(url)
            console.log('[OSMD] Fetch response status:', response.status, 'content-type:', response.headers.get('content-type'))
            if (!response.ok) throw new Error(`Failed to fetch score: ${response.status}`)
            const buffer = await response.arrayBuffer()
            const bytes = new Uint8Array(buffer)
            console.log('[OSMD] Fetched bytes:', bytes.length, 'first 4 bytes:', Array.from(bytes.slice(0, 4)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '))

            // ZIP magic bytes (0x50 0x4B) indicate MXL (compressed MusicXML)
            const isZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B
            console.log('[OSMD] Detected format:', isZip ? 'MXL (ZIP)' : 'XML text')

            if (isZip) {
                // OSMD accepts Blob for MXL — wraps ArrayBuffer so JSZip can decompress
                const blob = new Blob([buffer], { type: 'application/vnd.recordare.musicxml' })
                console.log('[OSMD] Loading as Blob, size:', blob.size)
                await osmd.load(blob)
            } else {
                const decoder = new TextDecoder()
                const text = decoder.decode(buffer)
                console.log('[OSMD] Loading as text, length:', text.length, 'starts with:', text.slice(0, 200))
                await osmd.load(text)
            }
            osmd.render()

            osmdRef.current = osmd

            // Count measures
            const sheet = osmd.Sheet
            if (sheet) {
                setTotalMeasures(sheet.SourceMeasures?.length || 0)
            }

            setIsLoaded(true)
            console.log('[OSMD] Score loaded and rendered')
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to load score'
            setError(msg)
            console.error('[OSMD] Error:', msg)
        }
    }, [containerRef, autoResize, drawTitle, drawSubtitle])

    useEffect(() => {
        if (xmlUrl) {
            loadScore(xmlUrl)
        }

        return () => {
            if (osmdRef.current) {
                osmdRef.current.clear()
                osmdRef.current = null
            }
        }
    }, [xmlUrl, loadScore])

    return {
        osmd: osmdRef,
        isLoaded,
        error,
        totalMeasures,
        reload: loadScore,
    }
}
