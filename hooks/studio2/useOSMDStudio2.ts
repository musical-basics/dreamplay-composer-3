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

            // Fetch through the internal proxy so Studio2 can load remote
            // XML/MXL assets without browser-side CORS failures.
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

            // ── Reduce vertical gap between treble & bass staves ──────────────
            // Default BetweenStaffDistance is ~4 units; 2 brings them visually closer.
            osmd.EngravingRules.BetweenStaffDistance = 2
            // Suppress phantom label gap at the left of the first system.
            osmd.EngravingRules.InstrumentLabelTextHeight = 0

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

            const getContentWidthPxFromGraphicSheet = () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const graphicSheet = (osmd as any).GraphicSheet
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const measureList = (graphicSheet?.MeasureList || []) as any[]
                const unitInPixels = Number(graphicSheet?.UnitInPixels || 10)
                if (!Array.isArray(measureList) || measureList.length === 0) return 0

                let maxRightUnit = 0
                measureList.forEach((staves) => {
                    if (!Array.isArray(staves)) return
                    staves.forEach((staff) => {
                        const pos = staff?.PositionAndShape
                        const absX = Number(pos?.AbsolutePosition?.x)
                        const borderRight = Number(pos?.BorderRight)
                        if (!Number.isFinite(absX) || !Number.isFinite(borderRight)) return
                        const rightUnit = absX + borderRight
                        if (rightUnit > maxRightUnit) maxRightUnit = rightUnit
                    })
                })

                return maxRightUnit > 0 ? maxRightUnit * unitInPixels : 0
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

            const contentWidthFromGraphic = getContentWidthPxFromGraphicSheet()

            // Fallback DOM-based width measurement in case GraphicSheet metrics
            // are unavailable for a specific score/OSMD build.
            let contentWidthFromSvg = 0
            const containerRect = container.getBoundingClientRect()
            const svgs = container.querySelectorAll('svg')
            svgs.forEach((svg) => {
                const rect = svg.getBoundingClientRect()
                const right = rect.right - containerRect.left
                if (right > contentWidthFromSvg) contentWidthFromSvg = right
            })

            const contentWidth = Math.max(contentWidthFromGraphic, contentWidthFromSvg)
            const finalWidth = contentWidth > 0 ? contentWidth : 1200
            container.style.width = `${Math.ceil(finalWidth)}px`

            console.log('[Studio2 OSMD] width finalized', {
                contentWidthFromGraphic,
                contentWidthFromSvg,
                finalWidth,
            })

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
