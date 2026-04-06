'use client'

import { useState, useRef } from 'react'
import { X, Paperclip, Send, MessageCircleQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
    configId?: string
}

export function SupportModal({ configId }: Props) {
    const [open, setOpen] = useState(false)
    const [message, setMessage] = useState('')
    const [file, setFile] = useState<File | null>(null)
    const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
    const [errorMsg, setErrorMsg] = useState('')
    const fileRef = useRef<HTMLInputElement>(null)

    const reset = () => {
        setMessage('')
        setFile(null)
        setStatus('idle')
        setErrorMsg('')
    }

    const handleClose = () => {
        setOpen(false)
        setTimeout(reset, 300)
    }

    const handleSend = async () => {
        if (!message.trim() || status === 'sending') return
        setStatus('sending')
        setErrorMsg('')
        try {
            const form = new FormData()
            form.append('message', message.trim())
            if (configId) form.append('configId', configId)
            if (file) form.append('file', file)
            const res = await fetch('/api/support', { method: 'POST', body: form })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Send failed')
            setStatus('sent')
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
            setStatus('error')
        }
    }

    return (
        <>
            {/* Trigger button */}
            <button
                onClick={() => setOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            >
                <MessageCircleQuestion className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Something not working?</span>
            </button>

            {/* Backdrop */}
            {open && (
                <div
                    className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm"
                    onClick={handleClose}
                />
            )}

            {/* Modal */}
            {open && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none">
                    <div
                        className="pointer-events-auto w-full max-w-lg rounded-2xl bg-zinc-900 border border-zinc-700 shadow-2xl shadow-black/60 flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                            <div>
                                <h2 className="text-sm font-semibold text-white">Contact Support</h2>
                                <p className="text-xs text-zinc-400 mt-0.5">We'll get back to you as soon as possible</p>
                            </div>
                            <button onClick={handleClose} className="text-zinc-500 hover:text-white transition-colors">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Body */}
                        {status === 'sent' ? (
                            <div className="flex flex-col items-center justify-center py-12 px-6 text-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-green-500/15 flex items-center justify-center">
                                    <span className="text-2xl">✓</span>
                                </div>
                                <p className="text-sm font-medium text-white">Message sent!</p>
                                <p className="text-xs text-zinc-400">The team will review your issue shortly.</p>
                                <button onClick={handleClose} className="mt-2 px-4 py-1.5 rounded-lg bg-white text-black text-sm font-medium hover:bg-zinc-100 transition-colors">
                                    Close
                                </button>
                            </div>
                        ) : (
                            <div className="p-5 space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-xs text-zinc-400 font-medium">Describe the issue</label>
                                    <textarea
                                        value={message}
                                        onChange={e => setMessage(e.target.value)}
                                        placeholder="e.g. My .mxl file won't load, the score is blank, audio is out of sync..."
                                        rows={5}
                                        className="w-full px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500 resize-none"
                                    />
                                </div>

                                {/* File attachment */}
                                <div>
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        className="hidden"
                                        onChange={e => setFile(e.target.files?.[0] ?? null)}
                                    />
                                    {file ? (
                                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700">
                                            <Paperclip className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                                            <span className="text-xs text-zinc-300 truncate flex-1">{file.name}</span>
                                            <button onClick={() => setFile(null)} className="text-zinc-500 hover:text-white transition-colors shrink-0">
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => fileRef.current?.click()}
                                            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
                                        >
                                            <Paperclip className="w-3.5 h-3.5" />
                                            Attach a file (optional — .mxl, .xml, .mp3, screenshot...)
                                        </button>
                                    )}
                                </div>

                                {errorMsg && (
                                    <p className="text-xs text-red-400">{errorMsg}</p>
                                )}

                                <div className="flex justify-end gap-2 pt-1">
                                    <Button size="sm" variant="ghost" onClick={handleClose} className="text-zinc-400 hover:text-white">
                                        Cancel
                                    </Button>
                                    <Button
                                        size="sm"
                                        onClick={handleSend}
                                        disabled={!message.trim() || status === 'sending'}
                                        className="bg-purple-600 hover:bg-purple-500 text-white gap-1.5"
                                    >
                                        {status === 'sending' ? (
                                            <>
                                                <span className="w-3.5 h-3.5 border border-white/40 border-t-white rounded-full animate-spin inline-block" />
                                                Sending…
                                            </>
                                        ) : (
                                            <>
                                                <Send className="w-3.5 h-3.5" />
                                                Send to Support
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    )
}
