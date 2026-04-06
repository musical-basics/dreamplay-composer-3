'use client'

import * as React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { ArrowLeft, Music } from 'lucide-react'
import { SplitScreenLayout } from '@/components/studio2/layout/SplitScreenLayoutStudio2'
import { ViewerTransport } from '@/components/viewer/ViewerTransport'
import { useAppStore } from '@/lib/store'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'
import { parseMidiFile } from '@/lib/midi/parser'
import type { SongConfig, ParsedMidi } from '@/lib/types'
import { debug } from '@/lib/debug'

interface ViewerPageProps {
    config: SongConfig
}

export const ViewerPage: React.FC<ViewerPageProps> = ({ config }) => {
    const [parsedMidi, setParsedMidi] = useState<ParsedMidi | null>(null)
    const [displayTime, setDisplayTime] = useState(0)
    const displayRafRef = useRef<number>(0)
    const [loading, setLoading] = useState(true)
    const [loadingStage, setLoadingStage] = useState(0)

    const isPlaying = useAppStore((s) => s.isPlaying)
    const setPlaying = useAppStore((s) => s.setPlaying)
    const duration = useAppStore((s) => s.duration)
    const loadMidi = useAppStore((s) => s.loadMidi)
    const setAnchors = useAppStore((s) => s.setAnchors)
    const setBeatAnchors = useAppStore((s) => s.setBeatAnchors)
    const setIsLevel2Mode = useAppStore((s) => s.setIsLevel2Mode)
    const setSubdivision = useAppStore((s) => s.setSubdivision)

    // Force all visual effects ON for max wow
    const setRevealMode = useAppStore((s) => s.setRevealMode)
    const setHighlightNote = useAppStore((s) => s.setHighlightNote)
    const setGlowEffect = useAppStore((s) => s.setGlowEffect)
    const setPopEffect = useAppStore((s) => s.setPopEffect)
    const setJumpEffect = useAppStore((s) => s.setJumpEffect)
    const setShowScore = useAppStore((s) => s.setShowScore)
    const setShowWaterfall = useAppStore((s) => s.setShowWaterfall)
    const setShowCursor = useAppStore((s) => s.setShowCursor)
    const setReleaseTightness = useAppStore((s) => s.setReleaseTightness)

    const loadingStages = [
        'Loading sheet music...',
        'Parsing performance data...',
        'Building visualization...',
        'Preparing playback...',
        'Almost ready...',
    ]

    // Set all effects to ON on mount
    useEffect(() => {
        setRevealMode('NOTE')
        setHighlightNote(true)
        setGlowEffect(true)
        setPopEffect(true)
        setJumpEffect(true)
        setShowScore(true)
        setShowWaterfall(true)
        setShowCursor(true)
        setReleaseTightness(0.2)
    }, [setRevealMode, setHighlightNote, setGlowEffect, setPopEffect, setJumpEffect, setShowScore, setShowWaterfall, setShowCursor, setReleaseTightness])

    // Load config data
    useEffect(() => {
        if (config.anchors) setAnchors(config.anchors)
        if (config.beat_anchors) setBeatAnchors(config.beat_anchors)
        if (config.is_level2) setIsLevel2Mode(config.is_level2)
        if (config.subdivision) setSubdivision(config.subdivision)
    }, [config, setAnchors, setBeatAnchors, setIsLevel2Mode, setSubdivision])

    // Loading stages animation
    useEffect(() => {
        if (!loading) return
        const interval = setInterval(() => {
            setLoadingStage((prev) => Math.min(prev + 1, loadingStages.length - 1))
        }, 500)
        return () => clearInterval(interval)
    }, [loading, loadingStages.length])

    // Load MIDI file
    useEffect(() => {
        if (!config.midi_url) {
            setLoading(false)
            return
        }

        const loadMidiFromUrl = async () => {
            try {
                const proxiedMidiUrl = `/api/asset?url=${encodeURIComponent(config.midi_url!)}`
                const response = await fetch(proxiedMidiUrl, { cache: 'no-store' })
                if (!response.ok) {
                    throw new Error(`Failed to fetch MIDI: ${response.status}`)
                }
                const buffer = await response.arrayBuffer()
                const parsed = parseMidiFile(buffer)
                setParsedMidi(parsed)
                loadMidi(parsed)
                getPlaybackManager().duration = parsed.durationSec
                debug.log('[Viewer] MIDI loaded', { notes: parsed.notes.length, durationSec: parsed.durationSec })
            } catch (err) {
                console.error('[Viewer] Failed to load MIDI:', err)
            } finally {
                // Minimum 2s loading to show the branded spinner
                setTimeout(() => setLoading(false), 2000)
            }
        }
        loadMidiFromUrl()
    }, [config.midi_url, loadMidi])

    // rAF loop for display time
    useEffect(() => {
        const tick = () => {
            setDisplayTime(getPlaybackManager().getTime())
            displayRafRef.current = requestAnimationFrame(tick)
        }
        displayRafRef.current = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(displayRafRef.current)
    }, [])

    const handlePlayPause = useCallback(async () => {
        const pm = getPlaybackManager()
        if (isPlaying) {
            pm.pause()
            setPlaying(false)
        } else {
            await pm.play()
            setPlaying(true)
        }
    }, [isPlaying, setPlaying])

    const handleSeek = useCallback((time: number) => {
        getPlaybackManager().seek(time)
    }, [])

    // Spacebar shortcut
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
            if (e.code === 'Space') {
                e.preventDefault()
                handlePlayPause()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [handlePlayPause])

    if (loading) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
                <div className="flex flex-col items-center gap-6 max-w-md text-center">
                    <div className="relative">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center shadow-2xl shadow-purple-500/30 animate-pulse">
                            <Music className="w-8 h-8 text-white" />
                        </div>
                        <div className="absolute inset-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600 to-pink-500 animate-ping opacity-20" />
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-lg font-semibold text-white">{config.title || 'Untitled'}</h2>
                        <p className="text-sm text-purple-300 animate-pulse font-medium">
                            {loadingStages[loadingStage]}
                        </p>
                    </div>
                    <div className="w-64 bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-500 ease-out"
                            style={{ width: `${((loadingStage + 1) / loadingStages.length) * 100}%` }}
                        />
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="h-screen flex flex-col overflow-hidden bg-zinc-950">
            {/* Slim header */}
            <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/80 backdrop-blur-lg border-b border-zinc-800/60 shrink-0">
                <div className="flex items-center gap-3">
                    <Link
                        href="/"
                        className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors duration-200 text-sm"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span>Gallery</span>
                    </Link>
                    <div className="w-px h-5 bg-zinc-700" />
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                            <Music className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-white font-medium text-sm truncate max-w-[300px]">
                            {config.title || 'Untitled'}
                        </span>
                    </div>
                </div>
                <Link
                    href="/login"
                    className="px-4 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors duration-200 shadow-lg shadow-purple-500/20"
                >
                    Create Your Own
                </Link>
            </div>

            {/* Main visualization area */}
            <div className="flex-1 overflow-hidden">
                <SplitScreenLayout
                    audioUrl={config.audio_url || null}
                    xmlUrl={config.xml_url || null}
                    parsedMidi={parsedMidi}
                    isAdmin={false}
                />
            </div>

            {/* Transport bar */}
            <div className="shrink-0">
                <ViewerTransport
                    isPlaying={isPlaying}
                    currentTime={displayTime}
                    duration={duration}
                    onPlayPause={handlePlayPause}
                    onSeek={handleSeek}
                />
            </div>
        </div>
    )
}
