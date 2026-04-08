'use client'

import * as React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useUser } from '@clerk/nextjs'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Save, ArrowLeft, Music, FileMusic, FileAudio, SkipBack, Play, Pause, Square, FolderOpen, ChevronLeft, ChevronRight, Settings, Activity, Piano, Video, Globe, GlobeLock, RotateCw, Share2, Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { SplitScreenLayout } from '@/components/studio2/layout/SplitScreenLayoutStudio2'
import { AnchorSidebar } from '@/components/studio2/score/AnchorSidebarStudio2'
import { WaveformTimeline } from '@/components/studio2/score/WaveformTimelineStudio2'
import { MidiTimeline } from '@/components/studio2/score/MidiTimelineStudio2'
import { ScoreControls } from '@/components/studio2/score/ScoreControlsStudio2'
import { useAppStore } from '@/lib/store'
import { UploadWizardV2 } from '@/components/studio2/studio/UploadWizardV2Studio2'
import {
    DropdownMenu,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu'
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'
import { parseMidiFile } from '@/lib/midi/parser'
import type { SongConfig, ParsedMidi, BeatAnchor, XMLEvent, V5MapperState } from '@/lib/types'
import { EXPORT_QUALITY_LABELS, type ExportQualityPreset } from '@/lib/types/renderJob'
import { fetchConfigById, updateConfigAction, togglePublishAction } from '@/app/actions/config'
import { getAudioOffset } from '@/lib/engine/AudioHelpers'
import { createClient } from '@supabase/supabase-js'
import { debug } from '@/lib/debug'
import { captureAndUploadThumbnail } from '@/lib/utils/captureAndUploadThumbnail'
import { SupportModal } from '@/components/studio/SupportModal'

export default function AdminEditor() {
    const params = useParams()
    const router = useRouter()
    const searchParams = useSearchParams()
    const configId = params?.id as string
    const isAdmin = searchParams.get('admin') === 'true'
    const forceRemap = searchParams.get('remap') === 'true'

    // ── Auth guard: redirect unauthenticated users to login ──────────────
    const { isLoaded: authLoaded, isSignedIn } = useUser()
    useEffect(() => {
        if (authLoaded && !isSignedIn) {
            router.replace('/login')
        }
    }, [authLoaded, isSignedIn, router])

    const [config, setConfig] = useState<SongConfig | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [parsedMidi, setParsedMidi] = useState<ParsedMidi | null>(null)
    const [title, setTitle] = useState('')
    const [isRecording, setIsRecording] = useState(false)
    const [isAiMapping, setIsAiMapping] = useState(false)
    const [midiError, setMidiError] = useState<string | null>(null)
    const [nextMeasure, setNextMeasure] = useState(2)
    const [totalMeasures, setTotalMeasures] = useState(0)
    const [noteCounts, setNoteCounts] = useState<Map<number, number>>(new Map())
    const [xmlEvents, setXmlEvents] = useState<XMLEvent[]>([])
    const xmlEventsRef = useRef<XMLEvent[]>([]) // Persists fermata data across OSMD re-renders
    const resolvedXmlEventsRef = useRef<XMLEvent[]>([]) // Repeat-resolved events (used during mapping)
    const [v5State, setV5State] = useState<V5MapperState | null>(null)
    const [transcribing, setTranscribing] = useState(false)
    const [transcriptionJobId, setTranscriptionJobId] = useState<string | null>(null)
    const hasAutoMappedRef = useRef(false)
    const [displayTime, setDisplayTime] = useState(0)
    const displayRafRef = useRef<number>(0)
    const [showWorkingFiles, setShowWorkingFiles] = useState(true)
    const [showConfig, setShowConfig] = useState(false)
    const [showAdvanced, setShowAdvanced] = useState(false)
    const [isExporting, setIsExporting] = useState(false)
    const [lastExportJobId, setLastExportJobId] = useState<string | null>(null)
    const [exportQualityPreset, setExportQualityPreset] = useState<ExportQualityPreset>('fast')
    const [isPublished, setIsPublished] = useState(false)
    const [showSharePopover, setShowSharePopover] = useState(false)
    const [shareLinkCopied, setShareLinkCopied] = useState(false)
    const sharePopoverRef = useRef<HTMLDivElement>(null)
    // Tracks whether the score SVG has actually rendered — used to guard thumbnail capture
    const scoreRenderedRef = useRef(false)

    const [publishLoading, setPublishLoading] = useState(false)

    const anchors = useAppStore((s) => s.anchors)
    const beatAnchors = useAppStore((s) => s.beatAnchors)
    const setAnchors = useAppStore((s) => s.setAnchors)
    const setBeatAnchors = useAppStore((s) => s.setBeatAnchors)
    const isPlaying = useAppStore((s) => s.isPlaying)
    const setPlaying = useAppStore((s) => s.setPlaying)
    const darkMode = useAppStore((s) => s.darkMode)
    const setDarkMode = useAppStore((s) => s.setDarkMode)
    const revealMode = useAppStore((s) => s.revealMode)
    const setRevealMode = useAppStore((s) => s.setRevealMode)
    const highlightNote = useAppStore((s) => s.highlightNote)
    const setHighlightNote = useAppStore((s) => s.setHighlightNote)
    const glowEffect = useAppStore((s) => s.glowEffect)
    const setGlowEffect = useAppStore((s) => s.setGlowEffect)
    const popEffect = useAppStore((s) => s.popEffect)
    const setPopEffect = useAppStore((s) => s.setPopEffect)
    const jumpEffect = useAppStore((s) => s.jumpEffect)
    const setJumpEffect = useAppStore((s) => s.setJumpEffect)
    const releaseTightness = useAppStore((s) => s.releaseTightness)
    const setReleaseTightness = useAppStore((s) => s.setReleaseTightness)
    const scoreZoomX = useAppStore((s) => s.scoreZoomX)
    const setScoreZoomX = useAppStore((s) => s.setScoreZoomX)
    const isLocked = useAppStore((s) => s.isLocked)
    const setIsLocked = useAppStore((s) => s.setIsLocked)
    const showCursor = useAppStore((s) => s.showCursor)
    const setShowCursor = useAppStore((s) => s.setShowCursor)
    const isLevel2Mode = useAppStore((s) => s.isLevel2Mode)
    const setIsLevel2Mode = useAppStore((s) => s.setIsLevel2Mode)
    const subdivision = useAppStore((s) => s.subdivision)
    const setSubdivision = useAppStore((s) => s.setSubdivision)
    const currentMeasure = useAppStore((s) => s.currentMeasure)
    const duration = useAppStore((s) => s.duration)
    const loadMidi = useAppStore((s) => s.loadMidi)
    const showMidiTimeline = useAppStore((s) => s.showMidiTimeline)
    const setShowMidiTimeline = useAppStore((s) => s.setShowMidiTimeline)
    const showWaveformTimeline = useAppStore((s) => s.showWaveformTimeline)
    const setShowWaveformTimeline = useAppStore((s) => s.setShowWaveformTimeline)
    const showAnchorSidebar = useAppStore((s) => s.showAnchorSidebar)
    const setShowAnchorSidebar = useAppStore((s) => s.setShowAnchorSidebar)
    const showWaterfall = useAppStore((s) => s.showWaterfall)
    const setShowWaterfall = useAppStore((s) => s.setShowWaterfall)
    const showScore = useAppStore((s) => s.showScore)
    const setShowScore = useAppStore((s) => s.setShowScore)

    const audioInputRef = useRef<HTMLInputElement>(null)
    const xmlInputRef = useRef<HTMLInputElement>(null)
    const midiInputRef = useRef<HTMLInputElement>(null)

    const getFileNameFromUrl = (url: string | null | undefined) => {
        if (!url) return 'No file linked'
        try {
            const parsed = new URL(url)
            const raw = parsed.pathname.split('/').filter(Boolean).pop() || url
            return decodeURIComponent(raw)
        } catch {
            const fallback = url.split('?')[0].split('/').filter(Boolean).pop()
            return fallback ? decodeURIComponent(fallback) : url
        }
    }

    const uploadConfigFile = useCallback(async (file: File, fileType: 'audio' | 'xml' | 'midi') => {
        debug.log('[Studio2] Uploading config file via presigned URL', {
            configId, fileType, fileName: file.name, size: file.size,
        })

        // Normalize content type — browser file.type for .xml can be empty,
        // 'text/xml', or 'application/vnd.recordare.musicxml' which causes OSMD to
        // treat plain XML as a ZIP-compressed MXL file. Force a safe default.
        const getContentType = (f: File, type: 'audio' | 'xml' | 'midi'): string => {
            if (type === 'xml') return 'application/xml'
            if (type === 'midi') return 'audio/midi'
            return f.type || 'application/octet-stream'
        }
        const contentType = getContentType(file, fileType)

        // Step 1: Get a presigned PUT URL from the server (bypasses Vercel 4.5MB limit)
        const presignRes = await fetch(
            `/api/config-upload?configId=${configId}&fileType=${fileType}&fileName=${encodeURIComponent(file.name)}&contentType=${encodeURIComponent(contentType)}`
        )
        const presignPayload = await presignRes.json().catch(() => null)
        if (!presignRes.ok) {
            throw new Error(presignPayload?.error || `Failed to get upload URL: ${presignRes.status}`)
        }
        const { presignedUrl, finalFileUrl } = presignPayload as {
            presignedUrl: string
            finalFileUrl: string
        }

        // Step 2: PUT directly to R2 — no Vercel body limit
        const uploadRes = await fetch(presignedUrl, {
            method: 'PUT',
            headers: { 'Content-Type': contentType },
            body: file,
        })
        if (!uploadRes.ok) {
            throw new Error(`R2 upload failed: ${uploadRes.status}`)
        }

        return { finalFileUrl }
    }, [configId])



    useEffect(() => {
        const load = async () => {
            try {
                const data = await fetchConfigById(configId)
                if (data) {
                    setConfig(data)
                    setTitle(data.title)
                    setIsPublished(!!data.is_published)
                    setReleaseTightness(0.2)
                    if (forceRemap) {
                        // ?remap=true: ignore saved anchors so auto-run effect fires fresh
                        setAnchors([{ measure: 1, time: 0 }])
                        setBeatAnchors([])
                        setIsLevel2Mode(false)
                        hasAutoMappedRef.current = false
                    } else {
                        if (data.anchors) setAnchors(data.anchors)
                        if (data.beat_anchors) setBeatAnchors(data.beat_anchors)
                        if (data.is_level2) setIsLevel2Mode(data.is_level2)
                    }
                    if (data.subdivision) setSubdivision(data.subdivision)
                }
            } catch (err) {
                console.error('Failed to load config:', err)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [configId, forceRemap, setAnchors, setBeatAnchors, setIsLevel2Mode, setSubdivision, setReleaseTightness])

    // -----------------------------------------------------------------------
    // Supabase Realtime: watch for midi_url to be populated by AI transcription
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (config?.midi_url) return // already has MIDI, no need to watch

        const url = process.env.NEXT_PUBLIC_SUPABASE_URL
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        if (!url || !key) return

        const sb = createClient(url, key)
        const channel = sb
            .channel(`config-midi-watch:${configId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'composer',
                    table: 'configurations',
                    filter: `id=eq.${configId}`,
                },
                (payload) => {
                    const newMidiUrl = payload.new?.midi_url
                    if (newMidiUrl) {
                        debug.log('[Realtime] AI MIDI ready:', newMidiUrl)
                        setTranscribing(false)
                        setConfig((prev) => prev ? { ...prev, midi_url: newMidiUrl } : prev)
                    }
                }
            )
            .subscribe()

        return () => { sb.removeChannel(channel) }
    }, [configId, config?.midi_url])

    // -----------------------------------------------------------------------
    // Transcription trigger: queue job when live-audio mode completes
    // -----------------------------------------------------------------------
    const handleTranscribe = async () => {
        if (!config?.audio_url || transcribing) return
        setTranscribing(true)

        try {
            const res = await fetch('/api/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    configId,
                    audioUrl: config.audio_url,
                }),
            })
            const data = await res.json()
            if (data.jobId) {
                setTranscriptionJobId(data.jobId)
                debug.log('[Transcribe] Job queued:', data.jobId)
            }
        } catch (err) {
            console.error('[Transcribe] Failed to queue:', err)
            setTranscribing(false)
        }
    }

    // -----------------------------------------------------------------------
    // Poll transcription status as fallback (in case Realtime isn't configured)
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (!transcriptionJobId || !transcribing) return

        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/transcribe/status?jobId=${transcriptionJobId}`)
                const data = await res.json()
                if (data.state === 'completed' && data.returnvalue?.finalMidiUrl) {
                    setTranscribing(false)
                    setConfig((prev) => prev ? { ...prev, midi_url: data.returnvalue.finalMidiUrl } : prev)
                    clearInterval(interval)
                } else if (data.state === 'failed') {
                    setTranscribing(false)
                    clearInterval(interval)
                }
            } catch { /* non-fatal */ }
        }, 3000)

        return () => clearInterval(interval)
    }, [transcriptionJobId, transcribing])

    useEffect(() => {
        if (!config?.midi_url) return
        setMidiError(null)
        const loadMidiFromUrl = async () => {
            try {
                const proxiedMidiUrl = `/api/asset?url=${encodeURIComponent(config.midi_url!)}`
                debug.log('[Studio2] Loading MIDI through proxy', { proxiedMidiUrl, sourceUrl: config.midi_url })
                const response = await fetch(proxiedMidiUrl, { cache: 'no-store' })
                if (!response.ok) {
                    throw new Error(`Failed to fetch MIDI file: ${response.status} ${response.statusText}`)
                }
                const buffer = await response.arrayBuffer()
                const parsed = parseMidiFile(buffer)
                setParsedMidi(parsed)
                loadMidi(parsed)
                getPlaybackManager().duration = parsed.durationSec
                debug.log('[Studio2] MIDI loaded', { notes: parsed.notes.length, durationSec: parsed.durationSec })
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Failed to load MIDI'
                setMidiError(msg)
                console.error('Failed to load MIDI:', err)
            }
        }
        loadMidiFromUrl()
    }, [config?.midi_url, loadMidi])

    const handleSave = async () => {
        try {
            setSaving(true)
            await updateConfigAction(configId, {
                title, anchors, beat_anchors: beatAnchors,
                subdivision, is_level2: isLevel2Mode,
            })
        } catch (err) { console.error('Failed to save:', err) }
        finally { setSaving(false) }
    }

    const handleTogglePublish = async () => {
        setPublishLoading(true)
        const next = !isPublished
        setIsPublished(next) // optimistic
        try {
            // Auto-capture thumbnail on first publish (only if going Live and no thumbnail yet)
            // Capture is delayed to after score loads — see handleScoreLoaded
            // If score already rendered, capture immediately with 500ms settle time
            if (next && !config?.thumbnail_url && scoreRenderedRef.current) {
                setTimeout(() => {
                    captureAndUploadThumbnail(configId, 'score-thumbnail-target')
                        .then((url) => {
                            if (url) setConfig((prev) => prev ? { ...prev, thumbnail_url: url } : prev)
                        })
                }, 500)
            }
            await togglePublishAction(configId, next)
        } catch (err) {
            console.error('Failed to toggle publish:', err)
            setIsPublished(!next) // revert on failure
        } finally {
            setPublishLoading(false)
        }
    }

    const handleSaveAs = async () => {
        const newTitle = prompt('Enter a name for the copy:', `${title} (Copy)`)
        if (!newTitle) return
        try {
            setSaving(true)
            await updateConfigAction(configId, {
                title, anchors, beat_anchors: beatAnchors,
                subdivision, is_level2: isLevel2Mode,
            })
            const { duplicateConfigAction } = await import('@/app/actions/config')
            const newConfig = await duplicateConfigAction(configId, newTitle)
            router.push(`/studio2/edit/${newConfig.id}`)
        } catch (err) { console.error('Save As failed:', err) }
        finally { setSaving(false) }
    }

    const handleAudioUpload = async (fileOrEvent: File | React.ChangeEvent<HTMLInputElement>) => {
        const file = fileOrEvent instanceof File ? fileOrEvent : fileOrEvent.target.files?.[0]
        if (!file) return
        try {
            const { finalFileUrl } = await uploadConfigFile(file, 'audio')
            await updateConfigAction(configId, { audio_url: finalFileUrl })
            setConfig((prev) => prev ? { ...prev, audio_url: finalFileUrl } : prev)

            // Hotload: create audio element immediately so playback is ready
            const proxiedAudioUrl = `/api/asset?url=${encodeURIComponent(finalFileUrl)}`
            const audio = new Audio(proxiedAudioUrl)
            audio.crossOrigin = 'anonymous'
            const pm = getPlaybackManager()
            pm.setAudioElement(audio)
            audio.addEventListener('loadedmetadata', () => { pm.duration = audio.duration })
        } catch (err) { console.error(err) }
        if (!(fileOrEvent instanceof File)) fileOrEvent.target.value = ''
    }

    const handleXmlUpload = async (fileOrEvent: File | React.ChangeEvent<HTMLInputElement>) => {
        const file = fileOrEvent instanceof File ? fileOrEvent : fileOrEvent.target.files?.[0]
        if (!file) return
        try {
            const { finalFileUrl } = await uploadConfigFile(file, 'xml')
            await updateConfigAction(configId, { xml_url: finalFileUrl })
            setConfig((prev) => prev ? { ...prev, xml_url: finalFileUrl } : prev)
        } catch (err) { console.error(err) }
        if (!(fileOrEvent instanceof File)) fileOrEvent.target.value = ''
    }

    const handleMidiUpload = async (fileOrEvent: File | React.ChangeEvent<HTMLInputElement>) => {
        const file = fileOrEvent instanceof File ? fileOrEvent : fileOrEvent.target.files?.[0]
        if (!file) return
        try {
            const { finalFileUrl } = await uploadConfigFile(file, 'midi')
            await updateConfigAction(configId, { midi_url: finalFileUrl })
            setConfig((prev) => prev ? { ...prev, midi_url: finalFileUrl } : prev)

            const buffer = await file.arrayBuffer()
            const parsed = parseMidiFile(buffer, file.name)
            setParsedMidi(parsed); loadMidi(parsed)
            getPlaybackManager().duration = parsed.durationSec
        } catch (err) { console.error(err) }
        if (!(fileOrEvent instanceof File)) fileOrEvent.target.value = ''
    }

    const handleSetAnchor = useCallback((measure: number, time: number) => {
        setAnchors(anchors.map((a) => (a.measure === measure ? { ...a, time } : a)))
    }, [anchors, setAnchors])

    const handleDeleteAnchor = useCallback((measure: number) => {
        if (measure === 1) return
        setAnchors(anchors.filter((a) => a.measure !== measure))
        // Cascade: also remove all beat anchors for this measure
        setBeatAnchors((prev) => prev.filter((b) => b.measure !== measure))
    }, [anchors, setAnchors, setBeatAnchors])

    const handleSetBeatAnchor = useCallback((measure: number, beat: number, time: number) => {
        setBeatAnchors((prev) => {
            const filtered = prev.filter(b => !(b.measure === measure && b.beat === beat))
            const newBeats = [...filtered, { measure, beat, time }]
            return newBeats.sort((a, b) => {
                if (a.measure !== b.measure) return a.measure - b.measure
                return a.beat - b.beat
            })
        })
    }, [setBeatAnchors])

    const handleDeleteBeatAnchor = useCallback((measure: number, beat: number) => {
        setBeatAnchors((prev) => prev.filter((b) => !(b.measure === measure && b.beat === beat)))
    }, [setBeatAnchors])

    /** Remove all sub-beat anchors for a measure — keeps just the linear measure anchor */
    const handleSetMeasureConstant = useCallback((measure: number) => {
        setBeatAnchors((prev) => prev.filter((b) => b.measure !== measure))
    }, [setBeatAnchors])

    /** Add (or overwrite) a measure anchor at a given time — converts a Ghost row to a real anchor */
    const handleAddAnchor = useCallback((measure: number, time: number) => {
        const updated: import('@/lib/types').Anchor[] = [...anchors.filter((a) => a.measure !== measure), { measure, time }]
            .sort((a, b) => a.measure - b.measure)
        setAnchors(updated)
    }, [anchors, setAnchors])

    /** Resume AutoMapperV5 from the latest manually-set measure anchor forward */
    const handleMapFromLatestAnchor = useCallback(async () => {
        if (!parsedMidi) { alert('Please load a MIDI file first.'); return; }
        if (anchors.length === 0) { alert('No anchors set yet.'); return; }

        setIsAiMapping(true);
        try {
            const { resumeFromAnchor, stepV5 } = await import('@/lib/engine/AutoMapperV5');
            const evts = resolvedXmlEventsRef.current.length > 0 ? resolvedXmlEventsRef.current : xmlEventsRef.current;

            let state = resumeFromAnchor(anchors, beatAnchors, parsedMidi.notes, evts, 0.0625);

            while (state.status === 'running') {
                state = stepV5(state, parsedMidi.notes, evts);
            }

            setV5State(state);

            if (state.status === 'done' || state.status === 'paused') {
                setAnchors(state.anchors);
                setBeatAnchors(state.beatAnchors);
                setIsLevel2Mode(true);
                updateConfigAction(configId, {
                    anchors: state.anchors,
                    beat_anchors: state.beatAnchors,
                    is_level2: true,
                    subdivision,
                }).catch(err => console.error('[MapFromLatest] Failed to auto-save:', err));
            }
        } catch (err) {
            console.error('[MapFromLatest Error]', err);
            alert('Failed to resume mapping (check console).');
        } finally {
            setIsAiMapping(false);
        }
    }, [parsedMidi, anchors, beatAnchors, setAnchors, setBeatAnchors, setIsLevel2Mode, configId, subdivision]);


    const handlePlayPause = async () => {
        const pm = getPlaybackManager()
        if (isPlaying) { pm.pause(); setPlaying(false) }
        else { await pm.play(); setPlaying(true) }
    }

    const handleStop = useCallback(() => {
        const pm = getPlaybackManager()
        pm.pause()
        pm.seek(0)
        setPlaying(false)
        setDisplayTime(0)
    }, [setPlaying])

    const handleStartCloudExport = useCallback(async (overrideDurationSec?: number) => {
        const targetDurationSec = overrideDurationSec ?? duration

        if (!targetDurationSec || targetDurationSec <= 0) {
            alert('Playback duration is not ready yet.')
            return
        }

        setIsExporting(true)
        try {
            const res = await fetch('/api/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    configId,
                    durationSec: targetDurationSec,
                    qualityPreset: exportQualityPreset,
                }),
            })

            const data = await res.json()
            if (!res.ok) {
                throw new Error(data?.error || 'Export failed')
            }

            if (data.exportId) {
                setLastExportJobId(data.exportId)
            } else {
                throw new Error('No export ID returned')
            }
        } catch (err) {
            console.error('[Export] Failed to start cloud export:', err)
            alert(err instanceof Error ? err.message : 'Failed to start export')
        } finally {
            setIsExporting(false)
        }
    }, [configId, duration, exportQualityPreset])

    const formatTime = (s: number) => {
        const m = Math.floor(s / 60)
        const sec = Math.floor(s % 60)
        const cs = Math.floor((s % 1) * 100) // centiseconds (0-99)
        return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}:${cs.toString().padStart(2, '0')}`
    }

    // rAF loop to poll current playback time for the transport slider
    useEffect(() => {
        const tick = () => {
            setDisplayTime(getPlaybackManager().getTime())
            displayRafRef.current = requestAnimationFrame(tick)
        }
        displayRafRef.current = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(displayRafRef.current)
    }, [])

    const handleSeek = useCallback((time: number) => {
        getPlaybackManager().seek(time)
    }, [])

    const toggleRecordMode = () => {
        if (!isRecording) {
            const maxMeasure = anchors.length > 0 ? Math.max(...anchors.map((a) => a.measure)) : 1
            setNextMeasure(maxMeasure + 1)
        }
        setIsRecording(!isRecording)
    }

    const handleTap = useCallback(() => {
        if (!isRecording) return
        const time = getPlaybackManager().getTime()
        const measure = nextMeasure

        const existing = anchors.find(a => a.measure === measure)
        if (existing) {
            setAnchors(anchors.map(a => a.measure === measure ? { ...a, time } : a))
        } else {
            setAnchors([...anchors, { measure, time }].sort((a, b) => a.measure - b.measure))
        }
        setNextMeasure(measure + 1)
    }, [isRecording, nextMeasure, anchors, setAnchors])

    const handleClearAll = useCallback(() => {
        if (confirm("Are you sure you want to clear all mappings?")) {
            setAnchors([{ measure: 1, time: 0 }])
            setBeatAnchors([])
            setNextMeasure(2)
        }
    }, [setAnchors, setBeatAnchors])

    const handleScoreLoaded = useCallback((total: number, counts: Map<number, number>, events?: XMLEvent[]) => {
        setTotalMeasures(total)
        setNoteCounts(counts)
        // Persist xmlEvents in ref — update whenever new events arrive with different content
        if (events && events.length > 0) {
            const staleCount = xmlEventsRef.current.length
            if (staleCount === 0 || staleCount !== events.length) {
                xmlEventsRef.current = events
                setXmlEvents(events)
                const fermataCount = events.filter(e => e.hasFermata).length
                debug.log(`[EditPage] ${staleCount > 0 ? 'Updated' : 'Locked'} ${events.length} xmlEvents into ref (${fermataCount} fermatas)${staleCount > 0 ? ` — replaced ${staleCount} stale events` : ''}`)
            }
        }
        // Mark score as rendered — gates the thumbnail capture in handleTogglePublish
        scoreRenderedRef.current = true
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const handleAutoMap = useCallback(async (chordThresholdFraction: number) => {
        if (!parsedMidi) { alert('Please load a MIDI file first.'); return; }
        if (totalMeasures === 0 || xmlEventsRef.current.length === 0) { alert('Please wait for score to process.'); return; }

        setIsAiMapping(true);
        try {
            const { initV5, stepV5, resolveRepeats, simplifyDenseMeasures } = await import('@/lib/engine/AutoMapperV5');

            // Detect audio peak for initial offset (optional but helpful)
            let audioOffset = 0;
            try {
                audioOffset = await getAudioOffset(config?.audio_url || null);
            } catch (e) {
                console.warn('[AutoMap] Audio peak detection failed, using 0s offset');
            }

            // Pre-process 1: expand repeat sections if the MIDI follows them
            resolvedXmlEventsRef.current = resolveRepeats(xmlEventsRef.current, parsedMidi.notes);

            // Pre-process 2: decimate polyrhythm & dense measures to macro beats only
            // Prevents V5 window-tracker from thrashing on 4:3 cross-rhythms (e.g. Fantaisie Impromptu M5+)
            resolvedXmlEventsRef.current = simplifyDenseMeasures(resolvedXmlEventsRef.current);

            let state = initV5(parsedMidi.notes, resolvedXmlEventsRef.current, audioOffset, chordThresholdFraction);

            // Auto-run steps until paused or done
            while (state.status === 'running') {
                state = stepV5(state, parsedMidi.notes, resolvedXmlEventsRef.current);
            }

            setV5State(state);

            if (state.status === 'done') {
                setAnchors(state.anchors);
                setBeatAnchors(state.beatAnchors);
                setIsLevel2Mode(true);
                // Auto-save to DB so view page gets correct anchors immediately
                updateConfigAction(configId, {
                    anchors: state.anchors,
                    beat_anchors: state.beatAnchors,
                    is_level2: true,
                    subdivision,
                }).catch(err => console.error('[AutoMap] Failed to auto-save anchors:', err))
            } else if (state.status === 'paused') {
                // Apply partial results so user sees progress on the score
                setAnchors(state.anchors);
                setBeatAnchors(state.beatAnchors);
                setIsLevel2Mode(true);
                // Save partial anchors too — better than nothing for the view page
                updateConfigAction(configId, {
                    anchors: state.anchors,
                    beat_anchors: state.beatAnchors,
                    is_level2: true,
                    subdivision,
                }).catch(err => console.error('[AutoMap] Failed to auto-save partial anchors:', err))
            }
        } catch (err) {
            console.error('[AutoMap Error]', err);
            alert('Auto-mapping failed (check console).');
        } finally {
            setIsAiMapping(false);
        }
    }, [parsedMidi, totalMeasures, config?.audio_url, setAnchors, setBeatAnchors, setIsLevel2Mode, configId, subdivision]);

    // Auto-run Echolocation V5 once all data is ready and anchors haven't been mapped
    useEffect(() => {
        if (hasAutoMappedRef.current) return
        if (!parsedMidi || totalMeasures === 0 || xmlEvents.length === 0) return
        // Only auto-run if anchors are still at the default (just M1)
        if (anchors.length > 1) return

        hasAutoMappedRef.current = true
        debug.log('[EditPage] Auto-running Echolocation V5...')
        handleAutoMap(0.0625) // 64th note chord threshold (default)
    }, [parsedMidi, totalMeasures, xmlEvents, anchors.length, handleAutoMap])

    const handleConfirmGhost = useCallback(async () => {
        if (!v5State || v5State.status !== 'paused' || !v5State.ghostAnchor || !parsedMidi) return;

        const { confirmGhost, stepV5 } = await import('@/lib/engine/AutoMapperV5');
        let state = confirmGhost(v5State, v5State.ghostAnchor.time);
        const evts = resolvedXmlEventsRef.current.length > 0 ? resolvedXmlEventsRef.current : xmlEventsRef.current;

        // Continue stepping after confirm
        while (state.status === 'running') {
            state = stepV5(state, parsedMidi.notes, evts);
        }

        setV5State(state);
        setAnchors(state.anchors);
        setBeatAnchors(state.beatAnchors);
    }, [v5State, parsedMidi, setAnchors, setBeatAnchors]);

    const handleProceedMapping = useCallback(async () => {
        // Same as confirm — confirm at current ghost time, then continue
        await handleConfirmGhost();
    }, [handleConfirmGhost]);

    const handleRunV5ToEnd = useCallback(async () => {
        if (!v5State || !parsedMidi) return;

        const { runV5ToEnd } = await import('@/lib/engine/AutoMapperV5');
        const evts = resolvedXmlEventsRef.current.length > 0 ? resolvedXmlEventsRef.current : xmlEventsRef.current;
        const finalState = runV5ToEnd(v5State, parsedMidi.notes, evts);

        setV5State(finalState);
        setAnchors(finalState.anchors);
        setBeatAnchors(finalState.beatAnchors);
        setIsLevel2Mode(true);
        // Auto-save to DB
        updateConfigAction(configId, {
            anchors: finalState.anchors,
            beat_anchors: finalState.beatAnchors,
            is_level2: true,
            subdivision,
        }).catch(err => console.error('[RunV5ToEnd] Failed to auto-save anchors:', err))
    }, [v5State, parsedMidi, setAnchors, setBeatAnchors, setIsLevel2Mode, configId, subdivision]);

    const handleUpdateGhostTime = useCallback((time: number) => {
        if (!v5State || !v5State.ghostAnchor) return;
        setV5State({
            ...v5State,
            ghostAnchor: { ...v5State.ghostAnchor, time },
        });
    }, [v5State]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

            if (e.code === 'Space') { e.preventDefault(); handlePlayPause() }
            if (e.code === 'KeyA' && isRecording && isPlaying) {
                e.preventDefault()
                handleTap()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [isPlaying, isRecording, handlePlayPause, handleTap])


    // Fancy loading screen with staged messages
    const [loadingStage, setLoadingStage] = useState(0)
    const [minLoadingDone, setMinLoadingDone] = useState(false)
    const loadingStages = [
        'Initializing DreamPlay engine...',
        'Loading sheet music renderer...',
        'Parsing MIDI performance data...',
        'Mapping notes to score...',
        'Building waterfall visualization...',
        'Preparing audio sync...',
        'Almost ready...',
    ]

    // Minimum 3s loading screen — only for configs that have files to load
    const hasFilesToLoad = !!(config?.xml_url && config?.midi_url)
    useEffect(() => {
        if (!hasFilesToLoad) {
            setMinLoadingDone(true)
            return
        }
        const timer = setTimeout(() => setMinLoadingDone(true), 3000)
        return () => clearTimeout(timer)
    }, [hasFilesToLoad])

    const showLoading = loading || (!minLoadingDone && hasFilesToLoad)

    useEffect(() => {
        if (!showLoading) return
        const interval = setInterval(() => {
            setLoadingStage((prev) => Math.min(prev + 1, loadingStages.length - 1))
        }, 450)
        return () => clearInterval(interval)
    }, [showLoading, loadingStages.length])

    if (showLoading) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
                <div className="flex flex-col items-center gap-6 max-w-md text-center">
                    {/* Animated logo pulse */}
                    <div className="relative">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center shadow-2xl shadow-purple-500/30 animate-pulse">
                            <Music className="w-8 h-8 text-white" />
                        </div>
                        <div className="absolute inset-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600 to-pink-500 animate-ping opacity-20" />
                    </div>

                    {/* Stage text */}
                    <div className="space-y-2">
                        <h2 className="text-lg font-semibold text-white">Setting up your project</h2>
                        <p className="text-sm text-purple-300 animate-pulse font-medium">
                            {loadingStages[loadingStage]}
                        </p>
                    </div>

                    {/* Progress bar */}
                    <div className="w-64 bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-500 ease-out"
                            style={{ width: `${((loadingStage + 1) / loadingStages.length) * 100}%` }}
                        />
                    </div>

                    {/* Stage dots */}
                    <div className="flex items-center gap-1.5">
                        {loadingStages.map((_, i) => (
                            <div
                                key={i}
                                className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                                    i <= loadingStage ? 'bg-purple-400 scale-100' : 'bg-zinc-700 scale-75'
                                }`}
                            />
                        ))}
                    </div>
                </div>
            </div>
        )
    }

    if (!config?.xml_url || !config?.midi_url) {
        return (
            <div className="min-h-screen bg-zinc-950 flex flex-col">
                <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800 shrink-0">
                    <div className="flex items-center gap-3">
                        <Button variant="ghost" size="sm" onClick={() => router.push('/studio')} className="text-zinc-400 hover:text-white">
                            <ArrowLeft className="w-4 h-4 mr-1" /> Back
                        </Button>
                        <span className="text-white text-lg font-medium">{title || 'Untitled Song'}</span>
                    </div>
                </div>
                <div className="flex-1 overflow-auto">
                    {config && (
                        <UploadWizardV2
                            config={config}
                            onUploadAudio={handleAudioUpload}
                            onUploadXml={handleXmlUpload}
                            onUploadMidi={handleMidiUpload}
                            onTranscribe={handleTranscribe}
                            transcribing={transcribing}
                            transcriptionJobId={transcriptionJobId}
                        />
                    )}
                </div>
            </div>
        )
    }

    return (
        <div className="h-screen flex overflow-hidden bg-zinc-950">
            <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={handleAudioUpload} />
            <input ref={xmlInputRef} type="file" accept=".xml,.musicxml,.mxl" className="hidden" onChange={handleXmlUpload} />
            <input ref={midiInputRef} type="file" accept=".mid,.midi" className="hidden" onChange={handleMidiUpload} />

            {isAdmin && showAnchorSidebar && (
                <AnchorSidebar
                    anchors={anchors}
                    beatAnchors={beatAnchors}
                    currentMeasure={currentMeasure}
                    totalMeasures={totalMeasures || 100}
                    isLevel2Mode={isLevel2Mode}
                    darkMode={darkMode}
                    onSetAnchor={handleSetAnchor}
                    onDeleteAnchor={handleDeleteAnchor}
                    onSetBeatAnchor={handleSetBeatAnchor}
                    onDeleteBeatAnchor={handleDeleteBeatAnchor}
                    onSetMeasureConstant={handleSetMeasureConstant}
                    onAddAnchor={handleAddAnchor}
                    onMapFromLatestAnchor={handleMapFromLatestAnchor}
                    currentTime={displayTime}
                    onToggleLevel2={setIsLevel2Mode}
                    onTap={handleTap}
                    onClearAll={handleClearAll}
                    onAutoMap={handleAutoMap}
                    onConfirmGhost={handleConfirmGhost}
                    onProceedMapping={handleProceedMapping}
                    onRunV5ToEnd={handleRunV5ToEnd}
                    onUpdateGhostTime={handleUpdateGhostTime}
                    v5State={v5State}
                    isAiMapping={isAiMapping}
                />
            )}

            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex flex-col bg-zinc-900 border-b border-zinc-800 shrink-0">
                    {/* Row 1: Navigation, Title, Files, Transport, Record */}
                    <div className="flex items-center justify-between px-4 py-2">
                        <div className="flex items-center gap-3">
                            <Button variant="ghost" size="sm" onClick={() => router.push('/studio')} className="text-zinc-400 hover:text-white">
                                <ArrowLeft className="w-4 h-4 mr-1" /> Back
                            </Button>
                            <input
                                type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                                placeholder="Song title..."
                                className="bg-transparent border-none text-white text-lg font-medium focus:outline-none placeholder:text-zinc-600 w-64"
                            />
                            <Button size="sm" onClick={handleSave} disabled={saving} className="bg-green-600 hover:bg-green-700 text-white">
                                <Save className="w-3.5 h-3.5 mr-1" /> {saving ? 'Saving...' : 'Save'}
                            </Button>
                            <Button size="sm" variant="outline" onClick={handleSaveAs} disabled={saving} className="border-zinc-600 text-black hover:text-black">
                                Save As
                            </Button>
                            {/* Publish toggle */}
                            <button
                                id="studio2-publish-toggle"
                                onClick={handleTogglePublish}
                                disabled={publishLoading}
                                title={isPublished ? 'Click to unpublish (make private)' : 'Click to publish to community'}
                                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition-all duration-200 border ${
                                    isPublished
                                        ? 'bg-green-900/30 text-green-400 border-green-700/50 hover:bg-green-900/50'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-white hover:bg-zinc-700'
                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                {isPublished
                                    ? <Globe className="w-3.5 h-3.5" />
                                    : <GlobeLock className="w-3.5 h-3.5" />}
                                {publishLoading ? '...' : isPublished ? 'Live' : 'Draft'}
                            </button>
                            <Button variant="ghost" size="sm" onClick={() => router.push('/studio')} className="text-zinc-400 hover:text-white">
                                <FolderOpen className="w-3.5 h-3.5 mr-1" /> Open
                            </Button>
                             {/* Share button + popover */}
                            <div className="relative" ref={sharePopoverRef}>
                                <button
                                    onClick={() => setShowSharePopover(p => !p)}
                                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-semibold transition-all duration-200 bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_12px_rgba(147,51,234,0.4)] hover:shadow-[0_0_18px_rgba(147,51,234,0.6)]"
                                >
                                    <Share2 className="w-3.5 h-3.5" /> Share
                                </button>
                                {showSharePopover && (
                                    <div
                                        className="absolute left-0 top-full mt-2 z-50 w-80 rounded-xl bg-zinc-900 border border-zinc-700 shadow-2xl p-4 space-y-3"
                                        onMouseLeave={() => setShowSharePopover(false)}
                                    >
                                        <p className="text-xs font-semibold text-white">Share this composition</p>
                                        {!isPublished && (
                                            <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
                                                ⚠ Still a draft — only you can view this link
                                            </p>
                                        )}
                                        <div className="flex items-center gap-2">
                                            <input
                                                readOnly
                                                value={`${typeof window !== 'undefined' ? window.location.origin : 'https://composer.dreamplay.studio'}/view/${configId}`}
                                                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 font-mono focus:outline-none"
                                            />
                                            <button
                                                onClick={() => {
                                                    const url = `${window.location.origin}/view/${configId}`
                                                    navigator.clipboard.writeText(url)
                                                    setShareLinkCopied(true)
                                                    setTimeout(() => setShareLinkCopied(false), 2000)
                                                }}
                                                className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-all"
                                            >
                                                {shareLinkCopied
                                                    ? <><Check className="w-3.5 h-3.5" /> Copied!</>
                                                    : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowConfig(!showConfig)}
                                className={`h-7 px-2 flex items-center gap-1.5 text-[9px] uppercase font-bold tracking-wider transition-all ${showConfig ? 'text-green-400 bg-green-500/10 shadow-[inset_0_0_10px_rgba(34,197,94,0.1)]' : 'text-zinc-500 hover:text-zinc-300'}`}
                                title="Toggle Config Panel"
                            >
                                <Settings className="w-3 h-3" />
                                <span>Config</span>
                            </Button>
                            {/* Regenerate Mapping button */}
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    if (!parsedMidi || totalMeasures === 0 || xmlEvents.length === 0) {
                                        alert('Wait for MIDI and sheet music to finish loading first.')
                                        return
                                    }
                                    if (!confirm('Regenerate anchor mapping? This will overwrite your current anchors.')) return
                                    hasAutoMappedRef.current = false
                                    setAnchors([{ measure: 1, time: 0 }])
                                    setBeatAnchors([])
                                    setIsLevel2Mode(false)
                                }}
                                disabled={isAiMapping}
                                className="h-7 px-2 flex items-center gap-1.5 text-[9px] uppercase font-bold tracking-wider transition-all text-amber-500 hover:text-amber-300 hover:bg-amber-500/10"
                                title="Regenerate Echolocation V5 anchor mapping"
                            >
                                <RotateCw className={`w-3 h-3 ${isAiMapping ? 'animate-spin' : ''}`} />
                                <span>{isAiMapping ? 'Mapping...' : 'Remap'}</span>
                            </Button>
                        </div>

                        <div className="flex items-center gap-2">
                            {/* View Quick Toggles */}
                            <div className="flex items-center gap-1 bg-zinc-950/50 rounded-lg p-0.5 border border-zinc-800 mr-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowScore(!showScore)}
                                    className={`h-7 px-2 flex items-center gap-1.5 text-[9px] uppercase font-bold tracking-wider transition-all ${showScore ? 'text-blue-400 bg-blue-500/10 shadow-[inset_0_0_10px_rgba(59,130,246,0.1)]' : 'text-zinc-500 hover:text-zinc-300'}`}
                                    title="Toggle Sheet Music"
                                >
                                    <FileMusic className="w-3 h-3" />
                                    <span>Sheet</span>
                                </Button>
                                {isAdmin && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setShowWaveformTimeline(!showWaveformTimeline)}
                                        className={`h-7 px-2 flex items-center gap-1.5 text-[9px] uppercase font-bold tracking-wider transition-all ${showWaveformTimeline ? 'text-purple-400 bg-purple-500/10 shadow-[inset_0_0_10px_rgba(168,85,247,0.1)]' : 'text-zinc-500 hover:text-zinc-300'}`}
                                        title="Toggle Audio Waveform"
                                    >
                                        <Activity className="w-3 h-3" />
                                        <span>Waveform</span>
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowWaterfall(!showWaterfall)}
                                    className={`h-7 px-2 flex items-center gap-1.5 text-[9px] uppercase font-bold tracking-wider transition-all ${showWaterfall ? 'text-amber-400 bg-amber-500/10 shadow-[inset_0_0_10px_rgba(245,158,11,0.1)]' : 'text-zinc-500 hover:text-zinc-300'}`}
                                    title="Toggle Falling Keys Mode"
                                >
                                    <Piano className="w-3 h-3" />
                                    <span>Falling Keys</span>
                                </Button>
                            </div>

                            {/* Support button — visible to all users, passes configId for admin context */}
                            <SupportModal configId={configId} />

                            {/* Files Dropdown — visible to all users */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" className="border-zinc-700 text-black hover:text-black h-8">
                                        <FolderOpen className="w-3.5 h-3.5 mr-1" /> Files
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56 bg-zinc-900 border-zinc-800 text-zinc-300">
                                    <DropdownMenuLabel>Source Files</DropdownMenuLabel>
                                    <DropdownMenuSeparator className="bg-zinc-800" />
                                    <DropdownMenuItem onClick={() => audioInputRef.current?.click()} className="flex items-center justify-between">
                                        <div className="flex items-center">
                                            <FileAudio className="w-4 h-4 mr-2 text-purple-400" /> Audio (WAV/MP3)
                                        </div>
                                        {config?.audio_url && <div className="w-2 h-2 rounded-full bg-green-500" />}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => xmlInputRef.current?.click()} className="flex items-center justify-between">
                                        <div className="flex items-center">
                                            <FileMusic className="w-4 h-4 mr-2 text-blue-400" /> Score (XML)
                                        </div>
                                        {config?.xml_url && <div className="w-2 h-2 rounded-full bg-green-500" />}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => midiInputRef.current?.click()} className="flex items-center justify-between">
                                        <div className="flex items-center">
                                            <Music className="w-4 h-4 mr-2 text-amber-400" /> Performance (MIDI)
                                        </div>
                                        {config?.midi_url && <div className="w-2 h-2 rounded-full bg-green-500" />}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>

                            {isAdmin && (
                                <>
                                    {/* View Dropdown */}
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="outline" size="sm" className="border-zinc-700 text-black hover:text-black h-8">
                                                Settings
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-56 bg-zinc-900 border-zinc-800 text-zinc-300">
                                            <DropdownMenuLabel>Interface Views</DropdownMenuLabel>
                                            <DropdownMenuSeparator className="bg-zinc-800" />
                                            <DropdownMenuCheckboxItem checked={showAnchorSidebar} onCheckedChange={setShowAnchorSidebar}>
                                                Anchor Sidebar
                                            </DropdownMenuCheckboxItem>
                                            <DropdownMenuCheckboxItem checked={showMidiTimeline} onCheckedChange={setShowMidiTimeline}>
                                                MIDI Piano Roll
                                            </DropdownMenuCheckboxItem>
                                            <DropdownMenuCheckboxItem checked={showWaveformTimeline} onCheckedChange={setShowWaveformTimeline}>
                                                Audio Waveform
                                            </DropdownMenuCheckboxItem>
                                            <DropdownMenuCheckboxItem checked={showScore} onCheckedChange={setShowScore}>
                                                Sheet Music
                                            </DropdownMenuCheckboxItem>
                                            <DropdownMenuCheckboxItem checked={showWaterfall} onCheckedChange={setShowWaterfall}>
                                                Falling Keys Mode
                                            </DropdownMenuCheckboxItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>

                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="border-zinc-700 text-black hover:text-black h-8"
                                        onClick={() => router.push(`/studio/audit/${configId}`)}
                                    >
                                        Score Audit
                                    </Button>
                                </>
                            )}

                            <Button
                                variant="outline"
                                size="sm"
                                className="border-zinc-700 text-black hover:text-black h-8"
                                onClick={() => handleStartCloudExport()}
                                disabled={isExporting}
                            >
                                <Video className="w-3.5 h-3.5 mr-1" />
                                {isExporting ? 'Starting...' : 'Export Video'}
                            </Button>

                            {isAdmin && (
                                <>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="border-zinc-700 text-black hover:text-black h-8"
                                        onClick={() => handleStartCloudExport(5)}
                                        disabled={isExporting}
                                    >
                                        5s Test
                                    </Button>

                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="outline" size="sm" className="border-zinc-700 text-black hover:text-black h-8">
                                                {EXPORT_QUALITY_LABELS[exportQualityPreset]}
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-48 bg-zinc-900 border-zinc-800 text-zinc-300">
                                            <DropdownMenuLabel>Export Quality</DropdownMenuLabel>
                                            <DropdownMenuSeparator className="bg-zinc-800" />
                                            <DropdownMenuRadioGroup value={exportQualityPreset} onValueChange={(value) => setExportQualityPreset(value as ExportQualityPreset)}>
                                                <DropdownMenuRadioItem value="fast">
                                                    Fast
                                                </DropdownMenuRadioItem>
                                                <DropdownMenuRadioItem value="balanced">
                                                    Balanced
                                                </DropdownMenuRadioItem>
                                                <DropdownMenuRadioItem value="master">
                                                    Master
                                                </DropdownMenuRadioItem>
                                            </DropdownMenuRadioGroup>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </>
                            )}

                            {lastExportJobId && (
                                <span className="text-[11px] text-zinc-400 font-mono">
                                    {EXPORT_QUALITY_LABELS[exportQualityPreset].toLowerCase()} queued: {lastExportJobId.slice(0, 8)}...
                                </span>
                            )}

                        </div>
                    </div>

                    {/* Row 2: Transport Bar */}
                    <div className="flex items-center gap-3 px-4 py-2 bg-zinc-950 border-b border-zinc-800/50">
                        {/* Play/Pause — large centered button */}
                        <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => handleSeek(Math.max(0, displayTime - 5))} className="text-zinc-500 hover:text-white h-8 w-8 p-0" title="Skip back 5s">
                                <SkipBack className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleSeek(Math.max(0, displayTime - 0.05))} className="text-zinc-500 hover:text-white h-8 w-8 p-0" title="Back 1 frame">
                                <ChevronLeft className="w-4 h-4" />
                            </Button>
                            <Button onClick={handlePlayPause} className="bg-purple-600 hover:bg-purple-700 text-white rounded-full w-10 h-10 p-0 shadow-lg shadow-purple-500/20">
                                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleSeek(Math.min(duration, displayTime + 0.05))} className="text-zinc-500 hover:text-white h-8 w-8 p-0" title="Forward 1 frame">
                                <ChevronRight className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={handleStop} className="text-zinc-500 hover:text-white h-8 w-8 p-0" title="Stop">
                                <Square className="w-4 h-4" />
                            </Button>
                        </div>

                        {/* Time display */}
                        <div className="flex items-center gap-2 bg-zinc-900 rounded-lg px-3 py-1.5 border border-zinc-800">
                            <span className="font-mono text-sm text-purple-400 w-14 text-right tabular-nums font-semibold">
                                {formatTime(displayTime)}
                            </span>
                            <span className="text-zinc-600 text-xs">/</span>
                            <span className="font-mono text-sm text-zinc-500 w-14 tabular-nums">
                                {formatTime(duration)}
                            </span>
                        </div>

                        {/* Seek slider — takes remaining space */}
                        <div className="flex-1 min-w-0">
                            <Slider
                                value={[displayTime]}
                                min={0}
                                max={duration || 100}
                                step={0.1}
                                onValueChange={(v) => handleSeek(v[0])}
                                className="[&_[data-slot=slider-track]]:bg-zinc-800 [&_[data-slot=slider-range]]:bg-purple-500 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:border-purple-500"
                            />
                        </div>

                        {/* Record */}
                        {isAdmin && (
                            <Button size="sm" onClick={toggleRecordMode} className={`text-white min-w-[100px] ${isRecording ? 'bg-red-600 hover:bg-red-700 animate-pulse' : 'bg-zinc-800 hover:bg-zinc-700 border border-zinc-700'}`}>
                                <span className={`inline-block w-2 h-2 rounded-full mr-2 ${isRecording ? 'bg-white' : 'bg-red-500'}`} />
                                {isRecording ? `Rec (M${nextMeasure})` : 'Record'}
                            </Button>
                        )}
                    </div>

                    {/* Combined Config Panel (toggle from nav bar) */}
                    {showConfig && (
                        <div className="px-4 py-3 border-t border-zinc-800/50 bg-zinc-900/40 space-y-4">
                            {/* Working Files — admin only */}
                            {isAdmin && (
                            <div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-2.5">
                                        <div className="flex items-center gap-2 text-[11px] text-blue-300 font-medium">
                                            <FileMusic className="w-3.5 h-3.5" /> XML Score
                                        </div>
                                        <p className="mt-1 text-xs text-zinc-300 truncate" title={getFileNameFromUrl(config?.xml_url)}>
                                            {getFileNameFromUrl(config?.xml_url)}
                                        </p>
                                        <Button variant="outline" size="sm" className="mt-2 h-7 border-zinc-700 text-black hover:text-black" onClick={() => xmlInputRef.current?.click()}>
                                            Upload New XML
                                        </Button>
                                    </div>
                                    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-2.5">
                                        <div className="flex items-center gap-2 text-[11px] text-amber-300 font-medium">
                                            <Music className="w-3.5 h-3.5" /> MIDI Performance
                                        </div>
                                        <p className="mt-1 text-xs text-zinc-300 truncate" title={getFileNameFromUrl(config?.midi_url)}>
                                            {getFileNameFromUrl(config?.midi_url)}
                                        </p>
                                        <Button variant="outline" size="sm" className="mt-2 h-7 border-zinc-700 text-black hover:text-black" onClick={() => midiInputRef.current?.click()}>
                                            Upload New MIDI
                                        </Button>
                                    </div>
                                    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-2.5">
                                        <div className="flex items-center gap-2 text-[11px] text-purple-300 font-medium">
                                            <FileAudio className="w-3.5 h-3.5" /> Audio Track (WAV/MP3)
                                        </div>
                                        <p className="mt-1 text-xs text-zinc-300 truncate" title={getFileNameFromUrl(config?.audio_url)}>
                                            {getFileNameFromUrl(config?.audio_url)}
                                        </p>
                                        <Button variant="outline" size="sm" className="mt-2 h-7 border-zinc-700 text-black hover:text-black" onClick={() => audioInputRef.current?.click()}>
                                            Upload New Audio
                                        </Button>
                                    </div>
                                </div>
                            </div>
                            )}

                            {/* Visual Appearance */}
                            <div>
                                <div className="flex flex-wrap items-end gap-4">
                                <div className="flex flex-col gap-1.5 min-w-0 flex-[1_1_720px]">
                                    <ScoreControls
                                        revealMode={revealMode} darkMode={darkMode} highlightNote={highlightNote}
                                        glowEffect={glowEffect} popEffect={popEffect} jumpEffect={jumpEffect}
                                        isLocked={isLocked} showCursor={showCursor} isAdmin={isAdmin}
                                        onRevealModeChange={setRevealMode} onDarkModeToggle={() => setDarkMode(!darkMode)}
                                        onHighlightToggle={() => setHighlightNote(!highlightNote)} onGlowToggle={() => setGlowEffect(!glowEffect)}
                                        onPopToggle={() => setPopEffect(!popEffect)} onJumpToggle={() => setJumpEffect(!jumpEffect)}
                                        onLockToggle={() => setIsLocked(!isLocked)} onCursorToggle={() => setShowCursor(!showCursor)}
                                    />
                                </div>

                                <div className="w-52">
                                    <div className="flex items-center justify-between mb-1">
                                        <Label className="text-[10px] text-zinc-500 uppercase font-bold">Zoom</Label>
                                        <span className="text-[10px] text-zinc-400 font-mono">{Math.round(scoreZoomX * 100)}%</span>
                                    </div>
                                    <Slider
                                        value={[scoreZoomX]}
                                        min={0.5}
                                        max={2.5}
                                        step={0.01}
                                        onValueChange={(v) => setScoreZoomX(v[0] ?? 1)}
                                        className="[&_[data-slot=slider-track]]:bg-zinc-700 [&_[data-slot=slider-range]]:bg-sky-500"
                                    />
                                </div>

                                <div className="w-52">
                                    <div className="flex items-center justify-between mb-1">
                                        <Label className="text-[10px] text-zinc-500 uppercase font-bold">Release Tightness</Label>
                                        <span className="text-[10px] text-zinc-400 font-mono">{Math.round(releaseTightness * 100)}%</span>
                                    </div>
                                    <Slider
                                        value={[releaseTightness]}
                                        min={0}
                                        max={1}
                                        step={0.01}
                                        onValueChange={(v) => setReleaseTightness(v[0] ?? 0.7)}
                                        className="[&_[data-slot=slider-track]]:bg-zinc-700 [&_[data-slot=slider-range]]:bg-cyan-500"
                                    />
                                </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div id="studio-preview" className="flex-1 overflow-hidden">
                    <SplitScreenLayout
                        audioUrl={config?.audio_url || null}
                        xmlUrl={config?.xml_url || null}
                        parsedMidi={parsedMidi}
                        isAdmin={isAdmin}
                        onUpdateAnchor={handleSetAnchor}
                        onUpdateBeatAnchor={handleSetBeatAnchor}
                        onScoreLoaded={handleScoreLoaded}
                    />
                </div>

                <div className="shrink-0 flex flex-col gap-0.5">
                    {midiError && (
                        <div className="px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                            <span className="font-medium">MIDI Error:</span>
                            <span className="truncate">{midiError}</span>
                        </div>
                    )}
                    {showMidiTimeline && (
                        <MidiTimeline
                            parsedMidi={parsedMidi}
                            anchors={anchors}
                            beatAnchors={beatAnchors}
                            ghostAnchor={v5State?.ghostAnchor}
                            isPlaying={isPlaying}
                            duration={duration}
                            onSeek={handleSeek}
                            onAnchorDrag={handleSetAnchor}
                            onBeatAnchorDrag={handleSetBeatAnchor}
                            darkMode={darkMode}
                        />
                    )}
                    {showWaveformTimeline && (
                        <WaveformTimeline
                            audioUrl={config?.audio_url || null}
                            anchors={anchors}
                            beatAnchors={beatAnchors}
                            isPlaying={isPlaying}
                            duration={duration}
                            onSeek={handleSeek}
                            onAnchorDrag={handleSetAnchor}
                            onBeatAnchorDrag={handleSetBeatAnchor}
                            darkMode={darkMode}
                        />
                    )}
                </div>
            </div>

        </div>
    )
}
