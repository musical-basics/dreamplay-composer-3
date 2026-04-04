'use client'

import * as React from 'react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { FileAudio, FileMusic, Music, CheckCircle2, ArrowRight, Upload, Loader2, Info, Mic, Piano } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { SongConfig } from '@/lib/types'

type UploadMode = 'live-audio' | 'midi-upload' | null

interface UploadWizardV2Props {
    config: SongConfig
    onUploadAudio: (file: File) => Promise<void>
    onUploadXml: (file: File) => Promise<void>
    onUploadMidi: (file: File) => Promise<void>
    onTranscribe?: () => void
    transcribing?: boolean
    transcriptionJobId?: string | null
}

export function UploadWizardV2({
    config,
    onUploadAudio,
    onUploadXml,
    onUploadMidi,
    onTranscribe,
    transcribing = false,
    transcriptionJobId = null,
}: UploadWizardV2Props) {
    const [mode, setMode] = useState<UploadMode>(null)
    const [uploading, setUploading] = useState<string | null>(null)
    const [lastUploadStatus, setLastUploadStatus] = useState<string | null>(null)
    const [uploadError, setUploadError] = useState<string | null>(null)
    const [pipelineLogs, setPipelineLogs] = useState<string[]>([])
    const [realProgress, setRealProgress] = useState<{ percent: number; stage: string } | null>(null)
    const [displayPercent, setDisplayPercent] = useState(0)
    const lastStageRef = useRef<string | null>(null)
    const logRef = useRef<HTMLDivElement>(null)

    const addLog = useCallback((msg: string) => {
        const ts = new Date().toLocaleTimeString()
        setPipelineLogs((prev) => [...prev, `[${ts}] ${msg}`])
        setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }), 50)
    }, [])

    // Fake progress stages for the pipeline log
    const fakeStagesRef = useRef<{ pct: number; msg: string }[]>([
        { pct: 15, msg: 'Allocating GPU resources...' },
        { pct: 22, msg: 'Loading AI model weights...' },
        { pct: 30, msg: 'Preprocessing audio waveform...' },
        { pct: 38, msg: 'Running spectral analysis...' },
        { pct: 45, msg: 'Detecting note onsets and pitches...' },
        { pct: 52, msg: 'Analyzing sustain pedal patterns...' },
        { pct: 58, msg: 'Refining velocity dynamics...' },
        { pct: 63, msg: 'Assembling MIDI sequence...' },
    ])
    const nextFakeIdx = useRef(0)

    // Smooth fake progress: ticks from 10% → 65% over ~30s while GPU is working
    useEffect(() => {
        if (!transcribing) { setDisplayPercent(0); nextFakeIdx.current = 0; return }

        const interval = setInterval(() => {
            setDisplayPercent((prev) => {
                const realPct = realProgress?.percent ?? 0
                // If real progress jumped ahead (e.g. 70%), snap to it
                if (realPct > prev) return realPct
                // Otherwise, slowly creep up but cap at 65% (GPU inference zone)
                if (prev < 65) {
                    const next = prev + 0.8
                    // Emit fake log at milestones
                    const stages = fakeStagesRef.current
                    const idx = nextFakeIdx.current
                    if (idx < stages.length && next >= stages[idx].pct) {
                        addLog(`[${stages[idx].pct}%] ${stages[idx].msg}`)
                        nextFakeIdx.current = idx + 1
                    }
                    return next
                }
                return prev
            })
        }, 500)

        return () => clearInterval(interval)
    }, [transcribing, realProgress, addLog])

    // Snap display to 100 when complete
    useEffect(() => {
        if (realProgress?.percent === 100) setDisplayPercent(100)
    }, [realProgress?.percent])

    // Poll transcription job progress
    useEffect(() => {
        if (!transcriptionJobId || !transcribing) return

        addLog('Transcription job queued — waiting for GPU...')

        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/transcribe/status?jobId=${transcriptionJobId}`)
                const data = await res.json()

                if (data.progress?.percent != null) {
                    if (lastStageRef.current !== data.progress.stage) {
                        lastStageRef.current = data.progress.stage
                        addLog(`[${data.progress.percent}%] ${data.progress.stage}`)
                    }
                    setRealProgress(data.progress)
                }

                if (data.state === 'completed') {
                    setRealProgress({ percent: 100, stage: 'Complete!' })
                    addLog('[100%] Transcription complete — loading MIDI into editor...')
                    clearInterval(interval)
                } else if (data.state === 'failed') {
                    addLog(`FAILED: ${data.failedReason || 'Unknown error'}`)
                    clearInterval(interval)
                }
            } catch { /* non-fatal */ }
        }, 2000)

        return () => clearInterval(interval)
    }, [transcriptionJobId, transcribing, addLog])

    const hasAudio = !!config.audio_url
    const hasXml = !!config.xml_url
    const hasMidi = !!config.midi_url

    // ---------- step logic per mode ----------
    const steps: Array<'xml' | 'midi' | 'audio'> =
        mode === 'live-audio'
            ? ['xml', 'audio']          // MusicXML → Master Audio (MIDI skipped — AI will generate)
            : ['xml', 'midi', 'audio']  // MusicXML → MIDI → Audio (audio optional)

    const isComplete =
        mode === 'live-audio'
            ? hasXml && hasAudio
            : hasXml && hasMidi // audio optional for midi-upload

    const uploaded: Record<string, boolean> = { xml: hasXml, midi: hasMidi, audio: hasAudio }
    const firstMissing = steps.findIndex((s) => !uploaded[s])
    const currentStep = firstMissing === -1 ? steps.length + 1 : firstMissing + 1
    const progress = ((currentStep - 1) / steps.length) * 100

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'audio' | 'xml' | 'midi') => {
        const file = e.target.files?.[0]
        if (!file) return

        setUploading(type)
        setUploadError(null)
        try {
            if (type === 'audio') await onUploadAudio(file)
            if (type === 'xml') await onUploadXml(file)
            if (type === 'midi') await onUploadMidi(file)
            setLastUploadStatus(type)
            setTimeout(() => setLastUploadStatus(null), 3000)
        } catch (err) {
            const msg = err instanceof Error ? err.message : `Upload failed for ${type}`
            setUploadError(msg)
            console.error(`Upload failed for ${type}:`, err)
        } finally {
            setUploading(null)
            e.target.value = ''
        }
    }

    const StepIcon = ({ step, active, completed }: { step: number; active: boolean; completed: boolean }) => {
        if (completed) return <CheckCircle2 className="w-6 h-6 text-green-500" />
        return (
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${active ? 'bg-purple-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>
                {step}
            </div>
        )
    }

    // ---------- Toasts ----------
    const toasts = (
        <>
            {lastUploadStatus && (
                <div className="fixed top-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="bg-green-600 text-white px-6 py-2.5 rounded-full shadow-xl shadow-green-500/20 flex items-center gap-2 font-bold border border-green-400/20">
                        <CheckCircle2 className="w-5 h-5" />
                        <span>Success! {lastUploadStatus === 'audio' ? 'Master Audio' : lastUploadStatus === 'xml' ? 'Sheet Music' : 'Performance MIDI'} Uploaded</span>
                    </div>
                </div>
            )}
            {uploadError && (
                <div className="fixed top-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="bg-red-600 text-white px-6 py-2.5 rounded-xl shadow-xl shadow-red-500/20 flex items-center gap-2 font-medium border border-red-400/20 max-w-lg">
                        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                        </svg>
                        <span className="text-sm truncate">{uploadError}</span>
                        <button onClick={() => setUploadError(null)} className="ml-2 text-white/70 hover:text-white shrink-0">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>
            )}
        </>
    )

    // =====================================================================
    // MODE SELECTOR
    // =====================================================================
    if (!mode) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] max-w-2xl mx-auto w-full p-8">
                {toasts}
                <div className="w-full mb-12 text-center">
                    <h2 className="text-3xl font-bold text-white mb-2">Configure Your Song</h2>
                    <p className="text-zinc-400">How would you like to set up this project?</p>
                </div>

                <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {/* Live Audio */}
                    <button
                        onClick={() => setMode('live-audio')}
                        className="group p-8 rounded-xl border border-zinc-800 bg-zinc-900/50 hover:border-purple-500/50 hover:bg-zinc-900 transition-all text-left"
                    >
                        <div className="w-12 h-12 rounded-xl bg-purple-600/20 flex items-center justify-center mb-5 group-hover:bg-purple-600/30 transition-colors">
                            <Mic className="w-6 h-6 text-purple-400" />
                        </div>
                        <h3 className="text-lg font-semibold text-white mb-2">Live Audio Upload</h3>
                        <p className="text-sm text-zinc-400 leading-relaxed">
                            Upload your recording and sheet music. AI will transcribe the MIDI automatically.
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                            <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded font-medium uppercase">MusicXML</span>
                            <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded font-medium uppercase">Audio</span>
                            <span className="text-[10px] bg-zinc-700/50 text-zinc-500 border border-zinc-600/30 px-2 py-0.5 rounded font-medium uppercase line-through">MIDI</span>
                        </div>
                    </button>

                    {/* MIDI Upload */}
                    <button
                        onClick={() => setMode('midi-upload')}
                        className="group p-8 rounded-xl border border-zinc-800 bg-zinc-900/50 hover:border-amber-500/50 hover:bg-zinc-900 transition-all text-left"
                    >
                        <div className="w-12 h-12 rounded-xl bg-amber-600/20 flex items-center justify-center mb-5 group-hover:bg-amber-600/30 transition-colors">
                            <Piano className="w-6 h-6 text-amber-400" />
                        </div>
                        <h3 className="text-lg font-semibold text-white mb-2">MIDI Upload</h3>
                        <p className="text-sm text-zinc-400 leading-relaxed">
                            Upload your own MIDI and sheet music. Master audio is optional — we'll use a default piano sound.
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                            <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded font-medium uppercase">MusicXML</span>
                            <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded font-medium uppercase">MIDI</span>
                            <span className="text-[10px] bg-zinc-700/50 text-zinc-400 border border-zinc-600/30 px-2 py-0.5 rounded font-medium uppercase">Audio (optional)</span>
                        </div>
                    </button>
                </div>

                <button
                    onClick={() => setMode('midi-upload')}
                    className="mt-8 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                    Skip — use classic 3-step upload
                </button>
            </div>
        )
    }

    // =====================================================================
    // STEP-BY-STEP UPLOAD (mode selected)
    // =====================================================================
    const stepConfigs: Record<string, { title: string; desc: string; icon: React.ReactNode; accept: string; successLabel: string; successMsg: string }> = {
        xml: {
            title: 'Sheet Music (MusicXML)',
            desc: 'Upload the XML file exported from Sibelius, Finale, or MuseScore.',
            icon: <FileMusic className="w-6 h-6 text-blue-400" />,
            accept: '.xml,.musicxml,.mxl',
            successLabel: 'Sheet Music',
            successMsg: 'Sheet music successfully uploaded and ready.',
        },
        midi: {
            title: 'Performance (MIDI)',
            desc: 'Upload the MIDI file corresponding to the performance.',
            icon: <Music className="w-6 h-6 text-amber-400" />,
            accept: '.mid,.midi',
            successLabel: 'Performance MIDI',
            successMsg: 'Performance MIDI successfully uploaded and ready.',
        },
        audio: {
            title: mode === 'midi-upload' ? 'Master Audio (Optional)' : 'Master Audio (WAV/MP3)',
            desc: mode === 'midi-upload'
                ? 'Optionally upload audio. If skipped, a default piano sound will be used.'
                : 'Upload your live recording that will be mapped and synced.',
            icon: <FileAudio className="w-6 h-6 text-purple-400" />,
            accept: 'audio/*',
            successLabel: 'Master Audio',
            successMsg: 'Audio file successfully uploaded and ready.',
        },
    }

    const modeLabel = mode === 'live-audio' ? 'Live Audio' : 'MIDI Upload'

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] max-w-2xl mx-auto w-full p-8 relative">
            {toasts}

            <div className="w-full mb-12 text-center">
                <h2 className="text-3xl font-bold text-white mb-2">Configure Your Song</h2>
                <p className="text-zinc-400">
                    Follow the steps below to prepare your sheet music and audio.
                </p>
                <button
                    onClick={() => setMode(null)}
                    className="mt-2 text-xs text-zinc-600 hover:text-zinc-400 transition-colors inline-flex items-center gap-1.5"
                >
                    <span className={`w-2 h-2 rounded-full ${mode === 'live-audio' ? 'bg-purple-500' : 'bg-amber-500'}`} />
                    {modeLabel} mode
                    <span className="underline">Change</span>
                </button>
            </div>

            <div className="w-full space-y-8">
                {/* Progress */}
                <div className="space-y-2">
                    <div className="flex justify-between text-xs font-medium text-zinc-500 uppercase tracking-wider">
                        <span>Progress</span>
                        <span>{Math.round(progress)}% Complete</span>
                    </div>
                    <Progress value={progress} className="h-2 bg-zinc-800" />
                </div>

                {/* Steps */}
                <div className="grid grid-cols-1 gap-4">
                    {steps.map((stepKey, idx) => {
                        const stepNum = idx + 1
                        const isActive = currentStep === stepNum
                        const isDone = uploaded[stepKey]
                        const cfg = stepConfigs[stepKey]
                        const isOptional = mode === 'midi-upload' && stepKey === 'audio'

                        return (
                            <div
                                key={stepKey}
                                className={`p-6 rounded-xl border transition-all ${
                                    isActive
                                        ? 'bg-zinc-900 border-purple-500/50 shadow-lg shadow-purple-500/5'
                                        : `bg-zinc-900/50 border-zinc-800 ${currentStep < stepNum ? 'opacity-40' : 'opacity-60'}`
                                }`}
                            >
                                <div className="flex items-start gap-4">
                                    <StepIcon step={stepNum} active={isActive} completed={isDone} />
                                    <div className="flex-1">
                                        <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
                                            {cfg.title}
                                            {isDone && (
                                                <span className="text-[10px] bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-0.5 rounded font-bold uppercase animate-in fade-in zoom-in duration-500">
                                                    Success!
                                                </span>
                                            )}
                                        </h3>
                                        <p className="text-sm text-zinc-400 mb-4">{cfg.desc}</p>
                                        {isDone && (
                                            <p className="text-xs text-green-500/80 font-medium mb-4 flex items-center gap-1.5 animate-in slide-in-from-left-2 duration-300">
                                                <CheckCircle2 className="w-3.5 h-3.5" />
                                                {cfg.successMsg}
                                            </p>
                                        )}

                                        {isActive && (
                                            <>
                                                <div className="relative">
                                                    <input
                                                        type="file"
                                                        accept={cfg.accept}
                                                        onChange={(e) => handleFileChange(e, stepKey)}
                                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                                        disabled={uploading !== null}
                                                    />
                                                    <Button className="w-full bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700 h-16 flex flex-col gap-1 items-center justify-center">
                                                        {uploading === stepKey ? (
                                                            <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
                                                        ) : (
                                                            <>
                                                                {cfg.icon}
                                                                <span className="text-xs">Click or drag to upload {cfg.successLabel}</span>
                                                            </>
                                                        )}
                                                    </Button>
                                                </div>

                                                {isOptional && !isDone && (
                                                    <button
                                                        onClick={() => window.location.reload()}
                                                        className="mt-3 w-full text-center text-xs text-zinc-500 hover:text-zinc-300 transition-colors py-2"
                                                    >
                                                        Skip — use default piano sound
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })}

                    {/* MIDI skipped notice for live-audio mode */}
                    {mode === 'live-audio' && (
                        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30 opacity-40">
                            <div className="flex items-center gap-3 text-sm text-zinc-500">
                                <Music className="w-5 h-5 text-zinc-600" />
                                <span>
                                    <span className="line-through">Performance (MIDI)</span>
                                    {' — '}AI will transcribe this from your audio automatically.
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Completion */}
                {isComplete && !transcribing && (
                    <div className="p-6 rounded-xl border border-green-500/30 bg-green-500/5 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-white mb-2">All Files Ready!</h3>
                        <p className="text-zinc-400 mb-6">
                            {mode === 'live-audio'
                                ? "Your sheet music and recording are uploaded. Click below to generate MIDI with AI."
                                : "You've successfully uploaded all necessary assets. You can now start mapping the score."}
                        </p>
                        <div className="flex flex-col gap-3">
                            {mode === 'live-audio' && onTranscribe ? (
                                <Button
                                    className="w-full bg-purple-600 hover:bg-purple-700 text-white py-6 text-lg font-bold shadow-lg shadow-purple-500/20"
                                    onClick={onTranscribe}
                                >
                                    AI Transcribe Audio to MIDI
                                </Button>
                            ) : (
                                <Button className="w-full bg-green-600 hover:bg-green-700 text-white py-6 text-lg font-bold shadow-lg shadow-green-500/20" onClick={() => window.location.reload()}>
                                    Enter Editor <ArrowRight className="w-5 h-5 ml-2" />
                                </Button>
                            )}
                            <div className="flex items-center justify-center gap-2 text-xs text-zinc-500">
                                <Info className="w-3 h-3" />
                                <span>{mode === 'live-audio' ? 'Our DreamPlay AI model will generate MIDI from your recording.' : 'Note: Full interface will be unlocked.'}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Transcription in progress */}
                {transcribing && (
                    <div className="p-6 rounded-xl border border-purple-500/30 bg-purple-500/5 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="text-center">
                            <Loader2 className="w-12 h-12 text-purple-500 mx-auto mb-4 animate-spin" />
                            <h3 className="text-xl font-bold text-white mb-2">
                                {realProgress?.stage
                                    ? `${realProgress.stage} (${Math.round(displayPercent)}%)`
                                    : `DreamPlay AI is transcribing... (${Math.round(displayPercent)}%)`}
                            </h3>
                            <p className="text-zinc-400 mb-4 text-sm">
                                Our DreamPlay AI model is analyzing your recording and generating a high-accuracy MIDI transcription.
                            </p>
                            <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                                <div
                                    className="h-full bg-purple-500 rounded-full transition-all duration-500 ease-out"
                                    style={{ width: `${Math.round(displayPercent)}%` }}
                                />
                            </div>
                        </div>

                        {/* Pipeline Log */}
                        <div className="mt-6">
                            <h4 className="text-xs font-medium text-zinc-500 mb-2 uppercase tracking-wider">Pipeline Log</h4>
                            <div
                                ref={logRef}
                                className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 h-48 overflow-y-auto font-mono text-xs text-zinc-400"
                            >
                                {pipelineLogs.length === 0 && (
                                    <span className="text-zinc-600">Waiting for activity...</span>
                                )}
                                {pipelineLogs.map((line, i) => (
                                    <div key={i}>{line}</div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
