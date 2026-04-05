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
        drawTitle = false,
        drawSubtitle = false,
    } = options

    const loadScore = useCallback(async (url: string) => {
        if (!containerRef.current) return

        try {
            setIsLoaded(false)
            setError(null)
            console.log('[Studio2 OSMD] loadScore:start', { url })

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

            // Apply rule-level options as well for consistency with some OSMD builds.
            osmd.setOptions({
                autoResize: false,
                renderSingleHorizontalStaffline: true,
                newSystemFromXML: false,
                newPageFromXML: false,
                newSystemFromNewPageInXML: false,
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
                const blob = new Blob([buffer], { type: 'application/vnd.recordare.musicxml' })
                await osmd.load(blob)
                console.log('[Studio2 OSMD] detected MXL zip payload')
            } else {
                const decoder = new TextDecoder()
                await osmd.load(decoder.decode(buffer))
                console.log('[Studio2 OSMD] detected plain XML payload')
            }

            // Ignore explicit system/page breaks embedded in MusicXML.
            osmd.EngravingRules.NewSystemAtXMLNewSystemAttribute = false
            osmd.EngravingRules.NewPageAtXMLNewPageAttribute = false
            osmd.EngravingRules.NewSystemAtXMLNewPageAttribute = false
            osmd.EngravingRules.RenderXMeasuresPerLineAkaSystem = 0
            osmd.EngravingRules.SheetMaximumWidth = Number.MAX_SAFE_INTEGER

            // Render in progressively wider containers until OSMD settles to
            // a single horizontal system (or we hit a conservative cap).
            const container = containerRef.current!
            const originalWidth = container.style.width
            container.style.maxWidth = 'none'
            container.style.display = 'block'

            const getSystemCount = () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const measureList = ((osmd as any).GraphicSheet?.MeasureList || []) as any[]
                if (!Array.isArray(measureList) || measureList.length === 0) return 0
                const yPositions = new Set<number>()
                measureList.forEach((staves) => {
                    const first = Array.isArray(staves) ? staves[0] : undefined
                    const y = first?.PositionAndShape?.AbsolutePosition?.y
                    if (typeof y === 'number' && Number.isFinite(y)) {
                        yPositions.add(Math.round(y))
                    }
                })
                return yPositions.size
            }

            let trialWidth = 1000000
            let systemCount = 0
            for (let attempt = 1; attempt <= 3; attempt++) {
                container.style.width = `${trialWidth}px`
                osmd.render()
                systemCount = getSystemCount()
                console.log('[Studio2 OSMD] render attempt', {
                    attempt,
                    trialWidth,
                    systemCount,
                    scrollWidth: container.scrollWidth,
                    childCount: container.children.length,
                })
                if (systemCount <= 1) break
                trialWidth *= 2
            }

            const finalWidth = Math.max(container.scrollWidth, container.getBoundingClientRect().width)
            container.style.width = finalWidth > 0 ? `${Math.ceil(finalWidth) + 50}px` : originalWidth

            if (systemCount > 1) {
                console.warn('[Studio2 OSMD] wrap persists after retries', {
                    systemCount,
                    finalWidth,
                })
            }

            osmdRef.current = osmd

            // Count measures
            const sheet = osmd.Sheet
            if (sheet) {
                setTotalMeasures(sheet.SourceMeasures?.length || 0)
                console.log('[Studio2 OSMD] measures', { count: sheet.SourceMeasures?.length || 0 })
            }

            setIsLoaded(true)
            console.log('[Studio2 OSMD] Score loaded and rendered')
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to load score'
            setError(msg)
            console.error('[Studio2 OSMD] Error:', msg)
        }
    }, [containerRef, drawTitle, drawSubtitle])

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
