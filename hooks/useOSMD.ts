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

            // MXL files (compressed MusicXML) need ArrayBuffer, not URL string.
            // OSMD's internal URL fetch doesn't handle MXL binary correctly.
            const isMxl = url.toLowerCase().includes('.mxl')
            if (isMxl) {
                // Fetch through proxy to avoid CORS, get binary
                const proxyUrl = `/api/xml?url=${encodeURIComponent(url)}`
                const response = await fetch(proxyUrl)
                const buffer = await response.arrayBuffer()
                await osmd.load(buffer)
            } else {
                await osmd.load(url)
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
