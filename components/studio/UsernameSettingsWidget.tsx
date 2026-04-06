'use client'

import { useState, useEffect } from 'react'
import { User, Check, X, Loader2, Pencil } from 'lucide-react'
import { getMyProfileAction, setUsernameAction, checkUsernameAvailabilityAction } from '@/app/actions/profile'

export function UsernameSettingsWidget() {
    const [currentUsername, setCurrentUsername] = useState<string | null>(null)
    const [displayName, setDisplayName] = useState<string>('')
    const [editing, setEditing] = useState(false)
    const [input, setInput] = useState('')
    const [saving, setSaving] = useState(false)
    const [checking, setChecking] = useState(false)
    const [availability, setAvailability] = useState<'available' | 'taken' | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [saveSuccess, setSaveSuccess] = useState(false)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        getMyProfileAction().then((profile) => {
            if (profile) {
                setCurrentUsername(profile.customUsername)
                setDisplayName(profile.displayName)
            }
            setLoading(false)
        })
    }, [])

    // Debounced availability check
    useEffect(() => {
        if (!editing || !input || input === currentUsername) {
            setAvailability(null)
            return
        }
        if (input.length < 3) { setAvailability(null); return }

        const timeout = setTimeout(async () => {
            setChecking(true)
            const result = await checkUsernameAvailabilityAction(input)
            setAvailability(result.available ? 'available' : 'taken')
            setChecking(false)
        }, 500)

        return () => clearTimeout(timeout)
    }, [input, editing, currentUsername])

    const handleSave = async () => {
        setSaving(true)
        setError(null)
        const result = await setUsernameAction(input.trim() || null)
        if (result.error) {
            setError(result.error)
        } else {
            setCurrentUsername(input.trim() || null)
            setDisplayName(result.displayName || '')
            setEditing(false)
            setSaveSuccess(true)
            setTimeout(() => setSaveSuccess(false), 3000)
        }
        setSaving(false)
    }

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-zinc-500 text-sm">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Loading profile...</span>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
                <User className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                {editing ? (
                    <div className="flex items-center gap-1.5">
                        <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 text-xs pointer-events-none">@</span>
                            <input
                                autoFocus
                                value={input}
                                onChange={(e) => { setInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setError(null) }}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
                                className="bg-zinc-800 border border-zinc-700 rounded-md pl-6 pr-2 py-1 text-xs text-white w-36 focus:outline-none focus:border-purple-500"
                                placeholder="your-handle"
                                maxLength={24}
                            />
                        </div>
                        {/* Availability indicator */}
                        {checking && <Loader2 className="w-3 h-3 animate-spin text-zinc-400" />}
                        {!checking && input && input !== currentUsername && input.length >= 3 && (
                            availability === 'available'
                                ? <span className="text-[10px] text-green-400">available</span>
                                : availability === 'taken'
                                    ? <span className="text-[10px] text-red-400">taken</span>
                                    : null
                        )}
                        <button
                            onClick={handleSave}
                            disabled={saving || availability === 'taken'}
                            className="w-6 h-6 rounded bg-purple-600 hover:bg-purple-700 disabled:opacity-40 flex items-center justify-center transition-colors"
                        >
                            {saving ? <Loader2 className="w-3 h-3 animate-spin text-white" /> : <Check className="w-3 h-3 text-white" />}
                        </button>
                        <button
                            onClick={() => { setEditing(false); setError(null) }}
                            className="w-6 h-6 rounded bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center transition-colors"
                        >
                            <X className="w-3 h-3 text-zinc-300" />
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5">
                        <span className="text-zinc-300 text-xs font-mono">
                            @{displayName}
                        </span>
                        {saveSuccess && <span className="text-[10px] text-green-400">saved!</span>}
                        <button
                            onClick={() => { setInput(currentUsername || ''); setEditing(true) }}
                            className="text-zinc-600 hover:text-zinc-300 transition-colors"
                            title="Change username"
                        >
                            <Pencil className="w-3 h-3" />
                        </button>
                    </div>
                )}
            </div>
            {error && <p className="text-red-400 text-[10px] ml-5">{error}</p>}
        </div>
    )
}
