'use client'

import * as React from 'react'
import { useRef, useEffect, useCallback, useState, memo } from 'react'
import { useOSMD } from '@/hooks/studio2/useOSMDStudio2'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'
import type { Anchor, BeatAnchor, ParsedMidi, XMLEvent } from '@/lib/types'
import { useAppStore } from '@/lib/store'

interface ScrollViewProps {
    xmlUrl: string | null
    parsedMidi?: ParsedMidi | null
    scoreZoomX?: number
    anchors: Anchor[]
    beatAnchors?: BeatAnchor[]
    isPlaying: boolean
    isAdmin?: boolean
    darkMode?: boolean
    revealMode?: 'OFF' | 'NOTE' | 'CURTAIN'
    highlightNote?: boolean
    glowEffect?: boolean
    popEffect?: boolean
    jumpEffect?: boolean
    isLocked?: boolean
    cursorPosition?: number
    curtainLookahead?: number
    showCursor?: boolean
    duration?: number
    onMeasureChange?: (measure: number) => void
    onUpdateAnchor?: (measure: number, time: number) => void
    onUpdateBeatAnchor?: (measure: number, beat: number, time: number) => void
    onScoreLoaded?: (totalMeasures: number, noteCounts: Map<number, number>, xmlEvents?: XMLEvent[]) => void
}

type NoteData = {
    id: string
    measureIndex: number
    timestamp: number
    durationFraction: number
    pitch: number | null
    element: HTMLElement | null
    stemElement: HTMLElement | null
    renderedNodes: HTMLElement[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isGraceLikeSourceNote = (sourceNote: any): boolean => {
    if (!sourceNote) return false
    if (sourceNote.IsGraceNote === true || sourceNote.isGraceNote === true) return true
    const lengthValue = sourceNote.Length?.RealValue
    if (typeof lengthValue === 'number' && lengthValue <= 0) return true
    if (sourceNote.NoteTypeXml === 'grace' || sourceNote.noteTypeXml === 'grace') return true
    return false
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getSourceNoteMidiPitch = (sourceNote: any): number | null => {
    if (!sourceNote?.Pitch) return null
    const pitch = sourceNote.Pitch
    try {
        const freq = pitch.Frequency || pitch.frequency
        if (freq && freq > 0) return Math.round(12 * Math.log2(freq / 440) + 69)
        return pitch.getHalfTone() + 12
    } catch {
        try {
            return pitch.getHalfTone() + 12
        } catch {
            return null
        }
    }
}

const velocityToHighlightColor = (velocity: number): string => {
    const v = Math.max(0, Math.min(127, velocity))
    let hue = 270
    if (v <= 20) hue = 270
    else if (v >= 110) hue = 0
    else hue = 270 * (1 - ((v - 20) / 90))
    return `hsl(${hue.toFixed(1)} 85% 55%)`
}

const velocityToGlowFilter = (velocity: number): string => {
    const v = Math.max(0, Math.min(127, velocity))
    let hue = 270
    if (v <= 20) hue = 270
    else if (v >= 110) hue = 0
    else hue = 270 * (1 - ((v - 20) / 90))
    const blurPx = 3 + (v / 127) * 9
    const alpha = 0.35 + (v / 127) * 0.55
    return `drop-shadow(0 0 ${blurPx.toFixed(1)}px hsla(${hue.toFixed(1)} 85% 55% / ${alpha.toFixed(2)}))`
}

const getFirstStartIndex = (notes: ParsedMidi['notes'], time: number): number => {
    let lo = 0
    let hi = notes.length
    while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (notes[mid].startTimeSec < time) lo = mid + 1
        else hi = mid
    }
    return lo
}

const lerp = (a: number, b: number, t: number): number => a + ((b - a) * t)

const ScrollViewComponent: React.FC<ScrollViewProps> = ({
    xmlUrl, parsedMidi = null, scoreZoomX = 1, anchors, beatAnchors = [], isPlaying, isAdmin = false, darkMode = false,
    revealMode = 'OFF', highlightNote = true, glowEffect = true, popEffect = false, jumpEffect = true,
    isLocked = true, cursorPosition = 0.2, curtainLookahead = 0.25, showCursor = true, duration = 100,
    onMeasureChange, onUpdateAnchor, onUpdateBeatAnchor, onScoreLoaded
}) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const osmdContainerRef = useRef<HTMLDivElement>(null)
    const cursorRef = useRef<HTMLDivElement>(null)
    const curtainRef = useRef<HTMLDivElement>(null)
    const scrollContainerRef = useRef<HTMLDivElement>(null)

    const { osmd, isLoaded, error } = useOSMD(osmdContainerRef, xmlUrl)
    const animationFrameRef = useRef<number>(0)

    const [measureXMap, setMeasureXMap] = useState<Map<number, number>>(new Map())
    const beatXMapRef = useRef<Map<number, Map<number, number>>>(new Map())
    const noteMap = useRef<Map<number, NoteData[]>>(new Map())
    const measureContentMap = useRef<Map<number, { el: HTMLElement; left: number; visible?: boolean }[]>>(new Map())
    const staffLinesRef = useRef<HTMLElement[]>([])
    const allSymbolsRef = useRef<HTMLElement[]>([])

    const lastMeasureIndexRef = useRef<number>(-1)
    const prevRevealModeRef = useRef<'OFF' | 'NOTE' | 'CURTAIN'>('OFF')
    const activeNotesRef = useRef<Set<NoteData>>(new Set())
    const effectsHashRef = useRef<string>('')
    const lastHeavyUpdateMsRef = useRef<number>(0)
    const lastManualScrollTimeRef = useRef<number>(0)
    const manualScrollIntentUntilRef = useRef<number>(0)
    const perfStatsRef = useRef({
        lastLogMs: 0,
        frames: 0,
        heavyFrames: 0,
        skippedHeavy: 0,
        heavyWorkMs: 0,
    })
    const dynamicColor = useAppStore((s) => s.dynamicColor)
    const releaseTightness = useAppStore((s) => s.releaseTightness)

    const applyScoreZoom = useCallback(() => {
        if (!osmdContainerRef.current) return
        const svgs = osmdContainerRef.current.querySelectorAll('svg')
        svgs.forEach((svgNode) => {
            const svg = svgNode as SVGSVGElement
            const dataset = svg.dataset as DOMStringMap

            let baseWidth = Number(dataset.baseWidth || '')
            if (!Number.isFinite(baseWidth) || baseWidth <= 0) {
                baseWidth = Number.parseFloat(svg.getAttribute('width') || '')
                if (!Number.isFinite(baseWidth) || baseWidth <= 0) baseWidth = svg.getBoundingClientRect().width
                dataset.baseWidth = String(baseWidth)
            }

            let baseHeight = Number(dataset.baseHeight || '')
            if (!Number.isFinite(baseHeight) || baseHeight <= 0) {
                baseHeight = Number.parseFloat(svg.getAttribute('height') || '')
                if (!Number.isFinite(baseHeight) || baseHeight <= 0) baseHeight = svg.getBoundingClientRect().height
                dataset.baseHeight = String(baseHeight)
            }

            svg.style.width = `${Math.max(1, baseWidth * scoreZoomX)}px`
            svg.style.height = `${Math.max(1, baseHeight)}px`
            svg.style.maxWidth = 'none'
        })
    }, [scoreZoomX])

    const findCurrentPosition = useCallback((time: number) => {
        if (!beatAnchors || beatAnchors.length === 0) {
            if (anchors.length === 0) return { measure: 1, beat: 1, progress: 0, isBeatInterpolation: false }
            const sorted = [...anchors].sort((a, b) => a.time - b.time)

            let currentM = 1, startT = 0, endT = Infinity
            for (let i = 0; i < sorted.length; i++) {
                if (time >= sorted[i].time) {
                    currentM = sorted[i].measure
                    startT = sorted[i].time
                    endT = (i + 1 < sorted.length) ? sorted[i + 1].time : Infinity
                } else break
            }
            let progress = 0
            if (endT !== Infinity && endT > startT) progress = Math.max(0, Math.min(1, (time - startT) / (endT - startT)))
            return { measure: currentM, beat: 1, progress, isBeatInterpolation: false }
        }

        const allPoints = [
            ...anchors.map(a => ({ measure: a.measure, beat: 1, time: a.time })),
            ...beatAnchors.map(b => ({ measure: b.measure, beat: b.beat, time: b.time }))
        ].sort((a, b) => a.time - b.time)

        let currentP = allPoints[0]
        let nextP = null

        for (let i = 0; i < allPoints.length; i++) {
            if (time >= allPoints[i].time) {
                currentP = allPoints[i]
                nextP = (i + 1 < allPoints.length) ? allPoints[i + 1] : null
            } else break
        }

        let progress = 0
        if (nextP && nextP.time > currentP.time) {
            progress = Math.max(0, Math.min(1, (time - currentP.time) / (nextP.time - currentP.time)))
        }
        if (!currentP) return { measure: 1, beat: 1, progress: 0, isBeatInterpolation: true }

        return {
            measure: currentP.measure, beat: currentP.beat,
            nextMeasure: nextP?.measure, nextBeat: nextP?.beat,
            progress, isBeatInterpolation: true
        }
    }, [anchors, beatAnchors])

    const applyColor = (element: HTMLElement, color: string) => {
        if (!element) return
        Array.from(element.getElementsByTagName('path')).forEach(p => { p.style.fill = color; p.style.stroke = color; p.setAttribute('fill', color); p.setAttribute('stroke', color) })
        Array.from(element.getElementsByTagName('rect')).forEach(r => { r.style.fill = color; r.style.stroke = color; r.setAttribute('fill', color); r.setAttribute('stroke', color) })
        element.style.fill = color; element.style.stroke = color
    }

    const resetNoteVisualEffects = useCallback((note: NoteData, defaultColor: string) => {
        if (!note.element) return
        applyColor(note.element, defaultColor)
        if (note.stemElement) applyColor(note.stemElement, defaultColor)
        note.element.style.filter = 'none'
        note.renderedNodes.forEach(node => {
            node.style.transform = 'scale(1) translateY(0)'
        })
    }, [])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calculateNoteMap = useCallback(() => {
        const instance = osmd.current
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!instance || !(instance as any).GraphicSheet || !containerRef.current) return

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const measureList = (instance as any).GraphicSheet.MeasureList
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unitInPixels = (instance as any).GraphicSheet.UnitInPixels || 10
        const xUnit = unitInPixels * scoreZoomX

        const newNoteMap = new Map<number, NoteData[]>()
        const newMeasureContentMap = new Map<number, { el: HTMLElement; left: number; visible?: boolean }[]>()
        const newAllSymbols: HTMLElement[] = []
        const newStaffLines: HTMLElement[] = []
        const newMeasureXMap = new Map<number, number>()
        const newBeatXMap = new Map<number, Map<number, number>>()
        const measureTimeSigMap = new Map<number, { numerator: number; denominator: number }>()

        const xmlEventsList: XMLEvent[] = []
        let cumulativeBeats = 0

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        measureList.forEach((staves: any[], index: number) => {
            const measureNumber = index + 1
            const sourceMeasure = instance.Sheet.SourceMeasures[index]
            const numerator = sourceMeasure?.ActiveTimeSignature ? sourceMeasure.ActiveTimeSignature.Numerator : 4
            const denominator = sourceMeasure?.ActiveTimeSignature ? sourceMeasure.ActiveTimeSignature.Denominator : 4
            measureTimeSigMap.set(measureNumber, { numerator, denominator })

            const beatPositions = new Map<number, number>()
            const uniqueFractionalBeats = new Set<number>()
            const beatAccumulator = new Map<number, { pitches: Set<number>, smallestDur: number, hasFermata: boolean }>()

            if (staves.length > 0) {
                const pos = staves[0].PositionAndShape
                const absoluteX = (pos.AbsolutePosition.x + pos.BorderLeft) * xUnit
                newMeasureXMap.set(measureNumber, absoluteX)

                const mStart = (pos.AbsolutePosition.x + pos.BorderLeft) * xUnit
                const mEnd = (pos.AbsolutePosition.x + pos.BorderRight) * xUnit
                const mWidth = mEnd - mStart

                try {
                    for (let b = 1; b <= numerator; b++) {
                        const targetFraction = (b - 1) / numerator
                        let bestX = mStart + (mWidth * targetFraction)

                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        staves.forEach((staffMeasure: any) => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            staffMeasure.staffEntries.forEach((entry: any) => {
                                const relX = entry.PositionAndShape.RelativePosition.x * xUnit
                                const linearX = mStart + (mWidth * targetFraction)
                                const actualEntryX = (staffMeasure.PositionAndShape.AbsolutePosition.x * xUnit) + relX
                                if (Math.abs(actualEntryX - linearX) < (mWidth / numerator) * 0.4) {
                                    bestX = actualEntryX
                                }
                            })
                        })
                        beatPositions.set(b, bestX)
                    }

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    staves.forEach((staffMeasure: any) => {
                        const staffMWidth = staffMeasure.PositionAndShape.BorderRight - staffMeasure.PositionAndShape.BorderLeft;
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        staffMeasure.staffEntries.forEach((entry: any) => {
                            let isRest = true;
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            entry.graphicalVoiceEntries?.forEach((gve: any) => {
                                if (gve.notes) {
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    gve.notes.forEach((n: any) => {
                                        if (n.sourceNote && n.sourceNote.Pitch && !isGraceLikeSourceNote(n.sourceNote)) isRest = false;
                                    });
                                }
                            });
                            if (isRest) return;

                            const relX = entry.PositionAndShape.RelativePosition.x;
                            let beatVal = 1;

                            if (entry.sourceStaffEntry && entry.sourceStaffEntry.Timestamp) {
                                beatVal = 1 + (entry.sourceStaffEntry.Timestamp.RealValue * denominator);
                            } else {
                                beatVal = 1 + ((staffMWidth > 0 ? relX / staffMWidth : 0) * numerator);
                            }
                            beatVal = Math.round(beatVal * 1000) / 1000;
                            uniqueFractionalBeats.add(beatVal);

                            const absX = (staffMeasure.PositionAndShape.AbsolutePosition.x + relX) * xUnit;
                            beatPositions.set(beatVal, absX);

                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            entry.graphicalVoiceEntries?.forEach((gve: any) => {
                                if (!gve.notes) return;
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                gve.notes.forEach((n: any) => {
                                    if (!n.sourceNote || !n.sourceNote.Pitch) return;
                                    if (isGraceLikeSourceNote(n.sourceNote)) return;
                                    const pitch = n.sourceNote.Pitch;

                                    const midiPitch = getSourceNoteMidiPitch(n.sourceNote) ?? 60

                                    const durQuarters = n.sourceNote.Length?.RealValue
                                        ? n.sourceNote.Length.RealValue * 4
                                        : 1;

                                    if (!beatAccumulator.has(beatVal)) {
                                        beatAccumulator.set(beatVal, { pitches: new Set(), smallestDur: durQuarters, hasFermata: false });
                                    }
                                    const acc = beatAccumulator.get(beatVal)!;
                                    acc.pitches.add(midiPitch);
                                    if (durQuarters < acc.smallestDur) acc.smallestDur = durQuarters;

                                    try {
                                        const ve = n.sourceNote?.ParentVoiceEntry;
                                        if (ve?.Articulations) {
                                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                            ve.Articulations.forEach((art: any) => {
                                                if (art.articulationEnum === 10 || art.articulationEnum === 11) {
                                                    acc.hasFermata = true;
                                                }
                                            });
                                        }
                                    } catch { /* ignore */ }
                                });
                            });
                        });
                    });

                    newBeatXMap.set(measureNumber, beatPositions)

                    const sortedBeats = Array.from(uniqueFractionalBeats).sort((a, b) => a - b);
                    sortedBeats.forEach(b => {
                        const acc = beatAccumulator.get(b);
                        const pitchArr = acc ? Array.from(acc.pitches) : [];
                        xmlEventsList.push({
                            measure: measureNumber,
                            beat: b,
                            globalBeat: cumulativeBeats + (b - 1),
                            pitches: pitchArr,
                            smallestDuration: acc ? acc.smallestDur : 1,
                            hasFermata: acc ? acc.hasFermata : false,
                        });
                    });

                } catch { /* ignore */ }
            }

            cumulativeBeats += numerator

            const measureNotes: NoteData[] = []
            const sig = measureTimeSigMap.get(measureNumber) || { numerator: 4, denominator: 4 }
            const measureWholeLength = Math.max(0.0001, sig.numerator / sig.denominator)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            staves.forEach((staffMeasure: any) => {
                const measurePos = staffMeasure.PositionAndShape
                const measureWidth = (measurePos.BorderRight - measurePos.BorderLeft) * xUnit
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                staffMeasure.staffEntries.forEach((entry: any) => {
                    if (!entry.graphicalVoiceEntries) return
                    const relX = entry.PositionAndShape.RelativePosition.x * xUnit
                    const relativeTimestamp = measureWidth > 0 ? relX / measureWidth : 0
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    entry.graphicalVoiceEntries.forEach((gve: any) => {
                        if (!gve.notes) return
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        gve.notes.forEach((note: any) => {
                            if (note.sourceNote && !note.sourceNote.Pitch) return
                            if (isGraceLikeSourceNote(note.sourceNote)) return
                            if (note.vfnote && note.vfnote.length > 0) {
                                const vfId = note.vfnote[0].attrs?.id
                                if (vfId) {
                                    const element = document.getElementById(vfId) || document.getElementById(`vf-${vfId}`)
                                    if (element) {
                                        if (element.classList.contains('vf-rest') || element.closest('.vf-rest')) return
                                        const group = element.closest('.vf-stavenote') as HTMLElement || element as HTMLElement
                                        group.querySelectorAll('path, rect').forEach(p => {
                                            const el = p as HTMLElement
                                            el.style.transformBox = 'fill-box'
                                            el.style.transformOrigin = 'center'
                                            el.style.transition = 'transform 0.1s ease-out, fill 0.1s, stroke 0.1s'
                                        })
                                        measureNotes.push({
                                            id: vfId,
                                            measureIndex: measureNumber,
                                            timestamp: relativeTimestamp,
                                            durationFraction: Math.max(
                                                0.01,
                                                Math.min(
                                                    2,
                                                    (note.sourceNote?.Length?.RealValue || 0.25) / measureWholeLength
                                                )
                                            ),
                                            pitch: getSourceNoteMidiPitch(note.sourceNote),
                                            element: group,
                                            stemElement: null,
                                            renderedNodes: Array.from(group.querySelectorAll('path, rect')) as HTMLElement[],
                                        })
                                    }
                                }
                            }
                        })
                    })
                })
            })
            measureNotes.sort((a, b) => a.timestamp - b.timestamp)
            newNoteMap.set(measureNumber, measureNotes)
        })

        const measureBounds: { index: number, left: number, right: number }[] = []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        measureList.forEach((staves: any[], index: number) => {
            let minX = Number.MAX_VALUE, maxX = Number.MIN_VALUE
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            staves.forEach((staff: any) => {
                const pos = staff.PositionAndShape
                const absX = pos.AbsolutePosition.x
                if (absX + pos.BorderLeft < minX) minX = absX + pos.BorderLeft
                if (absX + pos.BorderRight > maxX) maxX = absX + pos.BorderRight
            })
            if (minX < Number.MAX_VALUE) {
                measureBounds.push({ index: index + 1, left: (minX * xUnit) - 5, right: (maxX * xUnit) + 5 })
            }
        })

        if (containerRef.current) {
            const allElements = containerRef.current.querySelectorAll('svg path, svg rect, svg text')
            const containerLeft = containerRef.current.getBoundingClientRect().left
            for (let i = 0; i < allElements.length; i++) {
                const el = allElements[i] as HTMLElement
                const rect = el.getBoundingClientRect()
                const cl = el.classList
                const isMusical = cl.contains('vf-stavenote') || cl.contains('vf-beam') || cl.contains('vf-rest') || cl.contains('vf-clef') || cl.contains('vf-keysignature') || cl.contains('vf-timesignature') || cl.contains('vf-stem') || cl.contains('vf-modifier') || el.closest('.vf-stavenote, .vf-beam, .vf-rest, .vf-clef, .vf-keysignature, .vf-timesignature, .vf-stem, .vf-modifier') !== null

                if (!isMusical && rect.width > 50 && rect.height < 3) {
                    newStaffLines.push(el); continue
                }
                newAllSymbols.push(el)

                const elCenterX = (rect.left - containerLeft) + (rect.width / 2)
                const match = measureBounds.find(b => elCenterX >= b.left && elCenterX <= b.right)
                if (match) {
                    if (!newMeasureContentMap.has(match.index)) newMeasureContentMap.set(match.index, [])
                    newMeasureContentMap.get(match.index)!.push({ el, left: rect.left - containerLeft })
                }
            }
        }

        setMeasureXMap(newMeasureXMap)
        beatXMapRef.current = newBeatXMap
        noteMap.current = newNoteMap
        measureContentMap.current = newMeasureContentMap
        staffLinesRef.current = newStaffLines
        allSymbolsRef.current = newAllSymbols
        lastMeasureIndexRef.current = -1
        activeNotesRef.current.clear()

        if (onScoreLoaded) {
            const counts = new Map<number, number>()
            newNoteMap.forEach((notes, measureIndex) => {
                counts.set(measureIndex, notes.length)
            })
            console.log(`[ScrollView OSMD] Exported ${xmlEventsList.length} exact XML note events for mapping.`)
            onScoreLoaded(measureList.length, counts, xmlEventsList)
        }

    }, [osmd, onScoreLoaded, scoreZoomX])

    useEffect(() => {
        if (!isLoaded) return
        setTimeout(() => {
            applyScoreZoom()
            calculateNoteMap()
        }, 100)
    }, [isLoaded, calculateNoteMap, applyScoreZoom])

    useEffect(() => {
        const handleResize = () => setTimeout(() => {
            applyScoreZoom()
            calculateNoteMap()
        }, 500)
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [calculateNoteMap, applyScoreZoom])

    const updateMeasureVisibility = useCallback((currentMeasure: number) => {
        if (revealMode !== 'NOTE' || !measureContentMap.current) return
        measureContentMap.current.forEach((elements, measureNum) => {
            if (measureNum < currentMeasure) {
                elements.forEach(item => {
                    if (item.visible !== true) {
                        item.visible = true
                        item.el.style.opacity = '1'
                    }
                })
            } else if (measureNum > currentMeasure) {
                elements.forEach(item => {
                    if (item.visible !== false) {
                        item.visible = false
                        item.el.style.opacity = '0'
                    }
                })
            }
        })
    }, [revealMode])

    useEffect(() => {
        if (prevRevealModeRef.current === 'NOTE' && revealMode !== 'NOTE') {
            measureContentMap.current.forEach(elements => elements.forEach(item => {
                item.visible = true
                item.el.style.opacity = '1'
            }))
        }
        if (revealMode === 'NOTE') {
            const pm = getPlaybackManager()
            const { measure } = findCurrentPosition(pm.getTime())
            updateMeasureVisibility(measure)
        }
        if (revealMode === 'CURTAIN') {
            measureContentMap.current.forEach(elements => elements.forEach(item => {
                item.visible = true
                item.el.style.opacity = '1'
            }))
        }
        prevRevealModeRef.current = revealMode
    }, [revealMode, updateMeasureVisibility, findCurrentPosition])

    useEffect(() => {
        const baseColor = darkMode ? '#e0e0e0' : '#000000'
        const bgColor = darkMode ? '#18181b' : '#ffffff'
        allSymbolsRef.current.forEach(el => applyColor(el, baseColor))
        staffLinesRef.current.forEach(el => applyColor(el, baseColor))
        if (scrollContainerRef.current) scrollContainerRef.current.style.backgroundColor = bgColor
        if (curtainRef.current) curtainRef.current.style.backgroundColor = bgColor
    }, [darkMode, isLoaded])

    const updateCursorPosition = useCallback((audioTime: number) => {
        const frameStartMs = performance.now()
        const instance = osmd.current
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!instance || !isLoaded || !(instance as any).GraphicSheet) return

        const posData = findCurrentPosition(audioTime)
        const { measure, beat, progress, isBeatInterpolation } = posData
        const currentMeasureIndex = measure - 1

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const measureList = (instance as any).GraphicSheet.MeasureList
            if (!measureList || currentMeasureIndex >= measureList.length) return
            const measureStaves = measureList[currentMeasureIndex]
            if (!measureStaves || measureStaves.length === 0) return

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const unitInPixels = (instance as any).GraphicSheet.UnitInPixels || 10
            const xUnit = unitInPixels * scoreZoomX
            let firstStaffY = Number.MAX_VALUE, lastStaffY = Number.MIN_VALUE
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            measureStaves.forEach((staff: any) => {
                const absY = staff.PositionAndShape.AbsolutePosition.y
                if (absY < firstStaffY) firstStaffY = absY
                if (absY > lastStaffY) lastStaffY = absY
            })
            const systemTop = (firstStaffY - 4) * unitInPixels
            const systemHeight = ((lastStaffY - firstStaffY) + 12) * unitInPixels

            let measureMinX = Number.MAX_VALUE
            let measureMaxX = Number.MIN_VALUE
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            measureStaves.forEach((staff: any) => {
                const absX = staff.PositionAndShape.AbsolutePosition.x
                if (absX + staff.PositionAndShape.BorderLeft < measureMinX) measureMinX = absX + staff.PositionAndShape.BorderLeft
                if (absX + staff.PositionAndShape.BorderRight > measureMaxX) measureMaxX = absX + staff.PositionAndShape.BorderRight
            })
            const measureStartX = measureMinX * xUnit
            const measureEndX = measureMaxX * xUnit
            const measureWidth = Math.max(1, measureEndX - measureStartX)

            let cursorX = 0
            if (isBeatInterpolation && beatXMapRef.current.has(measure)) {
                const beatsInMeasure = beatXMapRef.current.get(measure)!
                let startX = beatsInMeasure.get(beat)
                if (startX === undefined) startX = (measureStaves[0].PositionAndShape.AbsolutePosition.x + measureStaves[0].PositionAndShape.BorderLeft) * xUnit

                let endX = 0
                if (posData.nextMeasure === measure && posData.nextBeat) endX = beatsInMeasure.get(posData.nextBeat) || startX
                else endX = (measureStaves[0].PositionAndShape.AbsolutePosition.x + measureStaves[0].PositionAndShape.BorderRight) * xUnit

                cursorX = startX + ((endX - startX) * progress)
            } else {
                cursorX = measureStartX + (measureWidth * progress)
            }

            let containerClientWidth = 0
            let containerScrollLeft = 0
            if (scrollContainerRef.current) {
                containerClientWidth = scrollContainerRef.current.clientWidth
                containerScrollLeft = scrollContainerRef.current.scrollLeft
            }

            if (cursorRef.current) {
                cursorRef.current.style.transform = `translateX(${cursorX}px)`
                cursorRef.current.style.top = `${systemTop}px`
                cursorRef.current.style.height = `${systemHeight}px`
                cursorRef.current.style.display = showCursor ? 'block' : 'none'
            }

            if (scrollContainerRef.current) {
                const container = scrollContainerRef.current
                const targetScrollLeft = cursorX - (containerClientWidth * cursorPosition)
                const pm = getPlaybackManager()
                const timeSinceManualScroll = performance.now() - lastManualScrollTimeRef.current
                const userIsManuallyScrolling = timeSinceManualScroll < 1200
                const userHasScrolledAway = Math.abs(containerScrollLeft - targetScrollLeft) > 100

                if (isLocked && pm.isPlaying) {
                    // Only auto-scroll if user hasn't manually scrolled recently, or if they've scrolled back near playback position
                    if (!userIsManuallyScrolling || !userHasScrolledAway) {
                        if (Math.abs(containerScrollLeft - targetScrollLeft) < 250) container.scrollLeft = targetScrollLeft
                        if (currentMeasureIndex !== lastMeasureIndexRef.current && Math.abs(containerScrollLeft - targetScrollLeft) > 50) {
                            container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' })
                        }
                    }
                } else if (currentMeasureIndex !== lastMeasureIndexRef.current) {
                    container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' })
                }
            }

            ;(window as any).__SCORE_TELEMETRY__ = {
                timeSec: audioTime,
                measure,
                beat,
                progress,
                cursorX,
                scrollLeft: scrollContainerRef.current?.scrollLeft ?? 0,
                containerWidth: containerClientWidth,
                locked: isLocked,
                playing: getPlaybackManager().isPlaying,
            }

            if (curtainRef.current) {
                if (revealMode === 'CURTAIN') {
                    curtainRef.current.style.display = 'block'
                    const offset = curtainLookahead * 600 * scoreZoomX
                    const curtainStart = cursorX + offset
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const measureListAll = (instance as any).GraphicSheet.MeasureList
                    const lastMeasureEntry = measureListAll[measureListAll.length - 1][0]
                    const totalWidth = (lastMeasureEntry.PositionAndShape.AbsolutePosition.x + lastMeasureEntry.PositionAndShape.BorderRight) * xUnit
                    curtainRef.current.style.left = `${curtainStart}px`
                    curtainRef.current.style.width = `${Math.max(0, totalWidth - curtainStart + 800)}px`
                    curtainRef.current.style.height = `${Math.max(containerRef.current?.scrollHeight || 0, containerRef.current?.clientHeight || 0)}px`
                } else {
                    curtainRef.current.style.display = 'none'
                }
            }

            const nowMs = performance.now()
            const shouldRunHeavyWork = nowMs - lastHeavyUpdateMsRef.current >= 33

            if (revealMode === 'NOTE') {
                if (currentMeasureIndex !== lastMeasureIndexRef.current || lastMeasureIndexRef.current === -1) updateMeasureVisibility(measure)
                const currentElements = measureContentMap.current.get(measure)
                if (currentElements) {
                    if (shouldRunHeavyWork) {
                        currentElements.forEach(item => {
                            const shouldShow = item.left <= cursorX + 2
                            if (item.visible !== shouldShow) {
                                item.visible = shouldShow
                                item.el.style.opacity = shouldShow ? '1' : '0'
                            }
                        })
                    }
                }
            }

            if (currentMeasureIndex !== lastMeasureIndexRef.current) {
                if (onMeasureChange) onMeasureChange(measure)

                // When changing measures, clear active notes to prevent stale highlights.
                const defaultColor = darkMode ? '#e0e0e0' : '#000000'
                activeNotesRef.current.forEach(note => resetNoteVisualEffects(note, defaultColor))
                activeNotesRef.current.clear()
            }
            lastMeasureIndexRef.current = currentMeasureIndex

            const notesInMeasure = noteMap.current.get(measure)
            const previewEffects = useAppStore.getState().previewEffects
            if (notesInMeasure && (!isAdmin || previewEffects)) {
                const globalProgress = Math.max(0, Math.min(1, (cursorX - measureStartX) / measureWidth))
                const defaultColor = darkMode ? '#e0e0e0' : '#000000'
                const highlightColor = '#10B981'

                let velocityByPitch: Map<number, number> | null = null
                if (dynamicColor && parsedMidi?.notes?.length) {
                    const notes = parsedMidi.notes
                    const windowRadius = lerp(0.08, 0.2, releaseTightness)
                    const windowStart = Math.max(0, audioTime - windowRadius)
                    const windowEnd = audioTime + windowRadius
                    let startIdx = getFirstStartIndex(notes, windowStart)
                    while (startIdx > 0 && notes[startIdx - 1].endTimeSec > windowStart) startIdx--

                    const map = new Map<number, number>()
                    for (let i = startIdx; i < notes.length; i++) {
                        const n = notes[i]
                        if (n.startTimeSec > windowEnd) break
                        if (n.endTimeSec <= windowStart) continue
                        const prev = map.get(n.pitch)
                        if (prev === undefined || n.velocity > prev) map.set(n.pitch, n.velocity)
                    }
                    velocityByPitch = map
                }

                const currentHash = `${darkMode}-${highlightNote}-${glowEffect}-${popEffect}-${jumpEffect}`
                const forceUpdate = currentHash !== effectsHashRef.current
                effectsHashRef.current = currentHash

                const currentlyActive = new Set<NoteData>()

                const lookahead = 0.04
                const noteEndThresholdOffset = 0.01
                const maxWindow = globalProgress + lookahead + 0.04

                notesInMeasure.forEach(note => {
                    if (!note.element) return
                    if (note.timestamp > maxWindow) return
                    const noteEndThreshold = note.timestamp + noteEndThresholdOffset
                    const sustainDuration = releaseTightness * note.durationFraction
                    const holdEnd = note.timestamp + Math.max(noteEndThresholdOffset, sustainDuration)
                    const inOnsetWindow = globalProgress <= noteEndThreshold && globalProgress >= note.timestamp - lookahead
                    const hasActiveMidiPitch = note.pitch !== null && velocityByPitch?.has(note.pitch)
                    const inHoldWindow = hasActiveMidiPitch && globalProgress >= note.timestamp - lookahead && globalProgress <= holdEnd
                    const isActive = inOnsetWindow || !!inHoldWindow

                    if (isActive) {
                        currentlyActive.add(note)

                        // Only mutate DOM when a note enters active state or toggles changed.
                        if ((forceUpdate || !activeNotesRef.current.has(note)) && shouldRunHeavyWork) {
                            const velocityColor = note.pitch !== null ? velocityByPitch?.get(note.pitch) : undefined
                            const dynamicFill = velocityColor === undefined ? highlightColor : velocityToHighlightColor(velocityColor)
                            const tFill = highlightNote ? dynamicFill : defaultColor
                            const tFilter = glowEffect
                                ? (velocityColor === undefined ? `drop-shadow(0 0 6px ${highlightColor})` : velocityToGlowFilter(velocityColor))
                                : 'none'
                            const tTransform = `scale(${popEffect ? 1.4 : 1}) translateY(${jumpEffect ? -10 : 0}px)`

                            applyColor(note.element, tFill)
                            if (note.stemElement) applyColor(note.stemElement, tFill)
                            note.element.style.filter = tFilter
                            note.renderedNodes.forEach(node => {
                                node.style.transform = tTransform
                            })
                        }
                    }
                })

                if (shouldRunHeavyWork) {
                    activeNotesRef.current.forEach(note => {
                        if (!currentlyActive.has(note)) {
                            resetNoteVisualEffects(note, defaultColor)
                        }
                    })

                    // Only advance visual active-state when DOM mutations are actually applied.
                    activeNotesRef.current = currentlyActive
                }
            } else if (isAdmin && !previewEffects && activeNotesRef.current.size > 0) {
                const defaultColor = darkMode ? '#e0e0e0' : '#000000'
                if (shouldRunHeavyWork) {
                    activeNotesRef.current.forEach(note => resetNoteVisualEffects(note, defaultColor))
                    activeNotesRef.current.clear()
                }
            }

            const frameEndMs = performance.now()
            const heavyWorkMs = frameEndMs - nowMs
            const stats = perfStatsRef.current
            stats.frames += 1
            if (shouldRunHeavyWork) {
                stats.heavyFrames += 1
                stats.heavyWorkMs += heavyWorkMs
                lastHeavyUpdateMsRef.current = frameEndMs
            } else {
                stats.skippedHeavy += 1
            }

            if (stats.lastLogMs === 0) stats.lastLogMs = frameStartMs
            if (frameEndMs - stats.lastLogMs >= 1000) {
                const avgHeavy = stats.heavyFrames > 0 ? stats.heavyWorkMs / stats.heavyFrames : 0
                console.log(
                    `[OSMD PERF] fps=${stats.frames} heavy=${stats.heavyFrames} skipped=${stats.skippedHeavy} ` +
                    `avgHeavyMs=${avgHeavy.toFixed(2)} measure=${measure}`
                )
                stats.frames = 0
                stats.heavyFrames = 0
                stats.skippedHeavy = 0
                stats.heavyWorkMs = 0
                stats.lastLogMs = frameEndMs
            }

        } catch { /* ignore */ }
    }, [findCurrentPosition, isLoaded, revealMode, updateMeasureVisibility, popEffect, jumpEffect, glowEffect, darkMode, highlightNote, cursorPosition, isLocked, curtainLookahead, showCursor, isAdmin, onMeasureChange, resetNoteVisualEffects, parsedMidi, dynamicColor, releaseTightness, scoreZoomX])

    useEffect(() => {
        if (!isLoaded) return

        // Expose refs for export pipelines (local and cloud)
        ;(window as any).__SCORE_SCROLL_CONTAINER__ = scrollContainerRef.current
        ;(window as any).__SCORE_CURSOR__ = cursorRef.current

        // In studio mode, exports drive frames manually via __ADVANCE_FRAME__.
        // Provide a synchronous score updater to keep cursor movement frame-accurate.
        if ((window as any).__STUDIO_MODE__) {
            ;(window as any).__UPDATE_SCORE__ = () => {
                updateCursorPosition(getPlaybackManager().getVisualTime())
            }

            return () => {
                ;(window as any).__UPDATE_SCORE__ = undefined
            }
        }

        const animate = () => {
            updateCursorPosition(getPlaybackManager().getVisualTime())
            animationFrameRef.current = requestAnimationFrame(animate)
        }
        animationFrameRef.current = requestAnimationFrame(animate)
        return () => cancelAnimationFrame(animationFrameRef.current)
    }, [isLoaded, updateCursorPosition])

    useEffect(() => {
        const container = scrollContainerRef.current
        if (!container) return

        const markManualScrollIntent = () => {
            manualScrollIntentUntilRef.current = performance.now() + 1200
        }

        const handleManualScroll = () => {
            const now = performance.now()
            if (now <= manualScrollIntentUntilRef.current) {
                lastManualScrollTimeRef.current = now
                manualScrollIntentUntilRef.current = now + 1200
            }
        }

        container.addEventListener('wheel', markManualScrollIntent, { passive: true })
        container.addEventListener('touchstart', markManualScrollIntent, { passive: true })
        container.addEventListener('pointerdown', markManualScrollIntent)
        container.addEventListener('keydown', markManualScrollIntent)
        container.addEventListener('scroll', handleManualScroll, { passive: true })

        return () => {
            container.removeEventListener('wheel', markManualScrollIntent)
            container.removeEventListener('touchstart', markManualScrollIntent)
            container.removeEventListener('pointerdown', markManualScrollIntent)
            container.removeEventListener('keydown', markManualScrollIntent)
            container.removeEventListener('scroll', handleManualScroll)
        }
    }, [])

    const handleScoreClick = useCallback((event: React.MouseEvent) => {
        const osmdInstance = osmd.current
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!osmdInstance || !(osmdInstance as any).GraphicSheet || !containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        const clickX = event.clientX - rect.left
        const clickY = event.clientY - rect.top

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const measureList = (osmdInstance as any).GraphicSheet.MeasureList
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unitInPixels = (osmdInstance as any).GraphicSheet.UnitInPixels || 10
        const xUnit = unitInPixels * scoreZoomX
        let clickedMeasureIndex = -1

        for (let i = 0; i < measureList.length; i++) {
            const measureStaves = measureList[i]
            if (!measureStaves) continue
            let minY = Number.MAX_VALUE, maxY = Number.MIN_VALUE, minX = Number.MAX_VALUE, maxX = Number.MIN_VALUE
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            measureStaves.forEach((staff: any) => {
                const pos = staff.PositionAndShape
                if (!pos) return
                if (pos.AbsolutePosition.y + pos.BorderTop < minY) minY = pos.AbsolutePosition.y + pos.BorderTop
                if (pos.AbsolutePosition.y + pos.BorderBottom > maxY) maxY = pos.AbsolutePosition.y + pos.BorderBottom
                if (pos.AbsolutePosition.x + pos.BorderLeft < minX) minX = pos.AbsolutePosition.x + pos.BorderLeft
                if (pos.AbsolutePosition.x + pos.BorderRight > maxX) maxX = pos.AbsolutePosition.x + pos.BorderRight
            })
            if (clickX >= minX * xUnit && clickX <= maxX * xUnit && clickY >= minY * unitInPixels && clickY <= maxY * unitInPixels) {
                clickedMeasureIndex = i
                break
            }
        }

        if (clickedMeasureIndex !== -1) {
            const measureNumber = clickedMeasureIndex + 1

            const exactBeatAnchor = beatAnchors
                .filter((b) => b.measure === measureNumber)
                .sort((a, b) => a.beat - b.beat)[0]
            if (exactBeatAnchor) {
                getPlaybackManager().seek(exactBeatAnchor.time)
                return
            }

            const sortedAnchors = [...anchors].sort((a, b) => a.measure - b.measure)
            const exactAnchor = sortedAnchors.find((a) => a.measure === measureNumber)
            if (exactAnchor) {
                getPlaybackManager().seek(exactAnchor.time)
                return
            }

            const lowerAnchor = [...sortedAnchors].reverse().find((a) => a.measure < measureNumber)
            const upperAnchor = sortedAnchors.find((a) => a.measure > measureNumber)

            if (lowerAnchor && upperAnchor && upperAnchor.measure > lowerAnchor.measure) {
                const ratio = (measureNumber - lowerAnchor.measure) / (upperAnchor.measure - lowerAnchor.measure)
                const interpolatedTime = lowerAnchor.time + ((upperAnchor.time - lowerAnchor.time) * ratio)
                getPlaybackManager().seek(interpolatedTime)
                return
            }

            if (lowerAnchor) {
                getPlaybackManager().seek(lowerAnchor.time)
                return
            }

            if (upperAnchor) {
                getPlaybackManager().seek(upperAnchor.time)
            }
        }
    }, [anchors, beatAnchors, osmd, scoreZoomX])

    return (
        <div ref={scrollContainerRef} className={`relative w-full h-full overflow-auto overscroll-none ${darkMode ? 'bg-zinc-900' : 'bg-white'}`}>
            <div ref={containerRef} onClick={handleScoreClick} className="relative min-w-full w-fit min-h-[400px]">

                {!isLoaded && xmlUrl && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center space-y-2">
                            <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
                            <p className={`text-sm ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>Loading score...</p>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <p className="text-red-400 text-sm">Error loading score: {error}</p>
                    </div>
                )}

                <div ref={osmdContainerRef} style={{ visibility: isLoaded ? 'visible' : 'hidden', filter: darkMode ? 'brightness(0.9)' : 'none' }} />

                <div ref={cursorRef} className="absolute pointer-events-none transition-none z-[1000]" style={{ display: 'none', width: '2px', backgroundColor: 'rgba(99,102,241,0.7)' }} />
                <div ref={curtainRef} className="absolute pointer-events-none z-[999]" style={{ display: 'none', top: 0, bottom: 0 }} />

                {dynamicColor && (
                    <div className={`absolute top-2 right-2 z-[1002] pointer-events-none rounded-md border px-2 py-1.5 ${darkMode ? 'bg-zinc-900/80 border-zinc-700 text-zinc-300' : 'bg-white/85 border-zinc-300 text-zinc-700'}`}>
                        <div className="text-[10px] uppercase tracking-wider font-semibold">Velocity Color</div>
                        <div className="mt-1 h-2 w-28 rounded-full" style={{ background: 'linear-gradient(90deg, hsl(270 85% 55%) 0%, hsl(180 85% 55%) 40%, hsl(90 85% 55%) 70%, hsl(0 85% 55%) 100%)' }} />
                        <div className="mt-1 flex justify-between text-[9px] opacity-80">
                            <span>soft</span>
                            <span>loud</span>
                        </div>
                    </div>
                )}

                {isAdmin && anchors.map(anchor => {
                    const leftPixel = measureXMap.get(anchor.measure)
                    if (leftPixel === undefined) return null
                    return (
                        <div key={`m-${anchor.measure}`} className="absolute top-0 flex flex-col items-center group z-[1001] cursor-ew-resize pointer-events-auto hover:scale-110 transition-transform origin-top"
                            style={{ left: `${leftPixel}px`, transform: 'translateX(-50%)' }}
                            onMouseDown={(e: React.MouseEvent) => {
                                e.stopPropagation()
                                const startX = e.clientX; const initialTime = anchor.time;
                                const totalWidth = containerRef.current?.scrollWidth || 1000
                                const secondsPerPixel = (duration || 100) / totalWidth
                                const handleUp = (upEvent: MouseEvent) => {
                                    if (onUpdateAnchor) onUpdateAnchor(anchor.measure, Math.max(0, initialTime + ((upEvent.clientX - startX) * secondsPerPixel)))
                                    window.removeEventListener('mouseup', handleUp)
                                }
                                window.addEventListener('mouseup', handleUp)
                            }}
                        >
                            <div className="bg-red-600/90 text-white text-[9px] font-bold px-1 rounded-sm shadow-sm mb-0.5 select-none">M{anchor.measure}</div>
                            <div className="w-0.5 h-full bg-red-600/50 shadow-[0_0_2px_rgba(0,0,0,0.3)]" />
                        </div>
                    )
                })}

                {isAdmin && beatAnchors.map(bAnchor => {
                    const beatMap = beatXMapRef.current.get(bAnchor.measure)
                    const leftPixel = beatMap ? beatMap.get(bAnchor.beat) : undefined
                    if (leftPixel === undefined) return null
                    return (
                        <div key={`b-${bAnchor.measure}-${bAnchor.beat}`} className="absolute top-6 flex flex-col items-center group z-[1000] cursor-ew-resize pointer-events-auto hover:scale-110 transition-transform origin-top"
                            style={{ left: `${leftPixel}px`, transform: 'translateX(-50%)' }}
                            onMouseDown={(e: React.MouseEvent) => {
                                e.stopPropagation()
                                const startX = e.clientX; const initialTime = bAnchor.time;
                                const totalWidth = containerRef.current?.scrollWidth || 1000
                                const secondsPerPixel = (duration || 100) / totalWidth
                                const handleUp = (upEvent: MouseEvent) => {
                                    if (onUpdateBeatAnchor) onUpdateBeatAnchor(bAnchor.measure, bAnchor.beat, Math.max(0, initialTime + ((upEvent.clientX - startX) * secondsPerPixel)))
                                    window.removeEventListener('mouseup', handleUp)
                                }
                                window.addEventListener('mouseup', handleUp)
                            }}
                        >
                            <div className="bg-yellow-500/90 text-black text-[8px] font-bold px-1 rounded-sm shadow-sm mb-0.5 select-none">{bAnchor.beat}</div>
                            <div className="w-0.5 h-full bg-yellow-500/50 shadow-[0_0_2px_rgba(0,0,0,0.3)]" />
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

export const ScrollView = memo(ScrollViewComponent)
export default ScrollView
