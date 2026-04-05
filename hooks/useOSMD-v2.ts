'use client'

import * as React from 'react'
import { useEffect, useRef, useState, useCallback } from 'react'
import { OpenSheetMusicDisplay as OSMD } from 'opensheetmusicdisplay'
import { debug } from '@/lib/debug'

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
                autoResize: false,
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
            const response = await fetch(url)
            if (!response.ok) throw new Error(`Failed to fetch score: ${response.status}`)
            const buffer = await response.arrayBuffer()
            const bytes = new Uint8Array(buffer)

            // ZIP magic bytes (0x50 0x4B) indicate MXL (compressed MusicXML)
            const isZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B
            if (isZip) {
                // OSMD accepts ArrayBuffer for MXL at runtime; types are incomplete
                await osmd.load(buffer as unknown as string)
            } else {
                const decoder = new TextDecoder()
                await osmd.load(decoder.decode(buffer))
            }

            // Ignore system/page breaks embedded in MusicXML
            osmd.EngravingRules.NewSystemAtXMLNewSystemAttribute = false
            osmd.EngravingRules.NewPageAtXMLNewPageAttribute = false
            osmd.EngravingRules.NewSystemAtXMLNewPageAttribute = false

            // Force container to be very wide before render so OSMD
            // lays out everything in a single horizontal system
            const container = containerRef.current!
            const originalWidth = container.style.width
            container.style.width = '999999px'
            osmd.render()
            // After render, shrink container to actual content width
            const svgs = container.querySelectorAll('svg')
            let maxRight = 0
            svgs.forEach(svg => {
                const rect = svg.getBoundingClientRect()
                const containerRect = container.getBoundingClientRect()
                const right = rect.right - containerRect.left
                if (right > maxRight) maxRight = right
            })
            container.style.width = maxRight > 0 ? `${Math.ceil(maxRight) + 50}px` : originalWidth

            osmdRef.current = osmd

            // Count measures
            const sheet = osmd.Sheet
            if (sheet) {
                setTotalMeasures(sheet.SourceMeasures?.length || 0)
            }

            setIsLoaded(true)
            debug.log('[OSMD] Score loaded and rendered')
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
