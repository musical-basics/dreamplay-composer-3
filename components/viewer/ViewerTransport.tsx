'use client'

import { Play, Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'

interface ViewerTransportProps {
    isPlaying: boolean
    currentTime: number
    duration: number
    onPlayPause: () => void
    onSeek: (time: number) => void
}

const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
}

export const ViewerTransport: React.FC<ViewerTransportProps> = ({
    isPlaying,
    currentTime,
    duration,
    onPlayPause,
    onSeek,
}) => {
    return (
        <div className="flex items-center gap-4 px-6 py-3 bg-zinc-900/80 backdrop-blur-lg border-t border-zinc-800/60">
            {/* Play/Pause — large purple button */}
            <Button
                id="viewer-play-pause"
                onClick={onPlayPause}
                className="bg-purple-600 hover:bg-purple-700 text-white rounded-full w-11 h-11 p-0 shadow-lg shadow-purple-500/25 transition-all duration-200 hover:scale-105 active:scale-95 shrink-0"
            >
                {isPlaying ? (
                    <Pause className="w-5 h-5" />
                ) : (
                    <Play className="w-5 h-5 ml-0.5" />
                )}
            </Button>

            {/* Time display */}
            <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-sm text-purple-400 w-14 text-right tabular-nums font-semibold">
                    {formatTime(currentTime)}
                </span>
                <span className="text-zinc-600 text-xs">/</span>
                <span className="font-mono text-sm text-zinc-500 w-14 tabular-nums">
                    {formatTime(duration)}
                </span>
            </div>

            {/* Seek slider */}
            <div className="flex-1 min-w-0">
                <Slider
                    value={[currentTime]}
                    min={0}
                    max={duration || 100}
                    step={0.1}
                    onValueChange={(v) => onSeek(v[0])}
                    className="[&_[data-slot=slider-track]]:bg-zinc-800 [&_[data-slot=slider-range]]:bg-purple-500 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:border-purple-500"
                />
            </div>
        </div>
    )
}
