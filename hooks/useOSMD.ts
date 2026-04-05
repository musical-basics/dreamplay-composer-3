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

            // Fetch through the internal proxy so localhost Studio can load
            // remote XML/MXL assets without browser-side CORS failures.
            const proxiedUrl = `/api/xml?url=${encodeURIComponent(url)}`
            const response = await fetch(proxiedUrl, { cache: 'no-store' })
            if (!response.ok) throw new Error(`Failed to fetch score: ${response.status}`)
            const buffer = await response.arrayBuffer()
            const bytes = new Uint8Array(buffer)

            // ZIP magic bytes (0x50 0x4B) indicate MXL (compressed MusicXML)
            const isZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B
            if (isZip) {
                const blob = new Blob([buffer], { type: 'application/vnd.recordare.musicxml' })
                await osmd.load(blob)
            } else {
                const decoder = new TextDecoder()
                await osmd.load(decoder.decode(buffer))
            }

            // Ignore explicit system/page breaks embedded in MusicXML.
            osmd.EngravingRules.NewSystemAtXMLNewSystemAttribute = false
            osmd.EngravingRules.NewPageAtXMLNewPageAttribute = false
            osmd.EngravingRules.NewSystemAtXMLNewPageAttribute = false
            osmd.EngravingRules.RenderXMeasuresPerLineAkaSystem = 0
            osmd.EngravingRules.SheetMaximumWidth = Number.MAX_SAFE_INTEGER

            // Also apply via setOptions for consistency with some OSMD builds.
            osmd.setOptions({
                autoResize: false,
                renderSingleHorizontalStaffline: true,
                newSystemFromXML: false,
                newPageFromXML: false,
                newSystemFromNewPageInXML: false,
            })

            // Render in progressively wider containers until OSMD settles to
            // a single horizontal system (or we hit a conservative cap).
            const container = containerRef.current!
            container.style.maxWidth = 'none'
            container.style.display = 'block'

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                console.log('[OSMD] render attempt', { attempt, trialWidth, systemCount })
                if (systemCount <= 1) break
                trialWidth *= 2
            }

            // Measure final content width from GraphicSheet
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const graphicSheet = (osmd as any).GraphicSheet
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const measureList = (graphicSheet?.MeasureList || []) as any[]
            const unitInPixels = Number(graphicSheet?.UnitInPixels || 10)
            let maxRightUnit = 0
            measureList.forEach((staves: any[]) => {
                if (!Array.isArray(staves)) return
                staves.forEach((staff: any) => {
                    const pos = staff?.PositionAndShape
                    const absX = Number(pos?.AbsolutePosition?.x)
                    const borderRight = Number(pos?.BorderRight)
                    if (Number.isFinite(absX) && Number.isFinite(borderRight)) {
                        const rightUnit = absX + borderRight
                        if (rightUnit > maxRightUnit) maxRightUnit = rightUnit
                    }
                })
            })
            const contentWidthFromGraphic = maxRightUnit > 0 ? maxRightUnit * unitInPixels : 0

            // Fallback: DOM-based measurement
            let contentWidthFromSvg = 0
            const containerRect = container.getBoundingClientRect()
            const svgs = container.querySelectorAll('svg')
            svgs.forEach(svg => {
                const rect = svg.getBoundingClientRect()
                const right = rect.right - containerRect.left
                if (right > contentWidthFromSvg) contentWidthFromSvg = right
            })

            const contentWidth = Math.max(contentWidthFromGraphic, contentWidthFromSvg)
            container.style.width = contentWidth > 0 ? `${Math.ceil(contentWidth)}px` : '1200px'

            if (systemCount > 1) {
                console.warn('[OSMD] wrap persists after retries', { systemCount })
            }

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
