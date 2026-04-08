// ============================================================================
// V5: ECHOLOCATION HEURISTIC MAPPER (Step-Through Engine)
// ============================================================================
//
// Pitch-aware, duration-aware, with interactive ghost anchor workflow.
// Does NOT modify V3/V4 code — fully self-contained.

import type { NoteEvent, Anchor, BeatAnchor, XMLEvent, V5MapperState } from '../types'
import { debug } from '@/lib/debug'

// Re-export audio offset helper from the shared module
export { getAudioOffset } from './AudioHelpers'

// ─── Helpers ───────────────────────────────────────────────────────────

type Outcome = 'match' | 'dead-reckon' | 'stray'
const V5_VERBOSE = true
const DEFAULT_TRACE_MIN_MEASURE = 8
const DEFAULT_TRACE_MAX_MEASURE = 12
let lastRunawayWarnKey = ''

function getTraceRange(): { min: number; max: number } {
    if (typeof window !== 'undefined') {
        const w = window as Window & {
            __V5_TRACE_MIN_MEASURE?: number
            __V5_TRACE_MAX_MEASURE?: number
        }
        const min = Number.isFinite(w.__V5_TRACE_MIN_MEASURE) ? Number(w.__V5_TRACE_MIN_MEASURE) : DEFAULT_TRACE_MIN_MEASURE
        const max = Number.isFinite(w.__V5_TRACE_MAX_MEASURE) ? Number(w.__V5_TRACE_MAX_MEASURE) : DEFAULT_TRACE_MAX_MEASURE
        return { min, max }
    }
    return { min: DEFAULT_TRACE_MIN_MEASURE, max: DEFAULT_TRACE_MAX_MEASURE }
}

function shouldTraceEvent(xmlEvent: XMLEvent): boolean {
    if (!V5_VERBOSE) return false
    const { min, max } = getTraceRange()
    return xmlEvent.measure >= min && xmlEvent.measure <= max
}

function v5Log(message: string): void {
    if (V5_VERBOSE) debug.log(message)
}

function v5LogFor(xmlEvent: XMLEvent, message: string): void {
    if (shouldTraceEvent(xmlEvent)) debug.log(message)
}

function v5WarnRunaway(xmlEvent: XMLEvent, badCount: number): void {
    if (!shouldTraceEvent(xmlEvent)) return
    const key = `${xmlEvent.measure}:${xmlEvent.beat}:${badCount}`
    if (key === lastRunawayWarnKey) return
    lastRunawayWarnKey = key
    console.warn(`[V5] 🛟 Runaway detected (${badCount}/10 bad). Auto-recovering without pause at M${xmlEvent.measure} B${xmlEvent.beat}.`)
}

function previewCandidates(candidates: { pitch: number; time: number; index: number }[], limit: number = 8): string {
    if (candidates.length === 0) return 'none'
    return candidates
        .slice(0, limit)
        .map(c => `{p:${c.pitch},t:${c.time.toFixed(3)},i:${c.index}}`)
        .join(' ')
}

/** Track recent outcomes, keeping only the last 20 */
function pushOutcome(outcomes: Outcome[], outcome: Outcome): Outcome[] {
    const updated = [...outcomes, outcome]
    return updated.length > 20 ? updated.slice(-20) : updated
}

/**
 * Check if accuracy has dropped below 80% over the last 20 events.
 * If ≥5/20 outcomes are non-matches (<80% accuracy), the mapper is confused
 * and should stop rather than cascade bad anchors across the rest of the piece.
 */
function isRunaway(outcomes: Outcome[]): boolean {
    if (outcomes.length < 20) return false
    const badCount = outcomes.filter((o: Outcome) => o !== 'match').length
    return badCount >= 5 // <80% match rate over last 20 events
}

/** Find first MIDI note whose pitch matches any of the expected pitches */
function findFirstPitchMatch(
    expectedPitches: number[],
    midiNotes: NoteEvent[],
    startIndex: number
): { time: number; index: number } | null {
    for (let i = startIndex; i < midiNotes.length; i++) {
        if (expectedPitches.includes(midiNotes[i].pitch)) {
            return { time: midiNotes[i].startTimeSec, index: i }
        }
    }
    return null
}

/** Scan a [minTime, maxTime] window for MIDI notes matching expected pitches */
function scanWindow(
    expectedPitches: number[],
    midiNotes: NoteEvent[],
    startIndex: number,
    minTime: number,
    maxTime: number
): { pitch: number; time: number; index: number }[] {
    const matches: { pitch: number; time: number; index: number }[] = []
    for (let i = startIndex; i < midiNotes.length; i++) {
        const note = midiNotes[i]
        if (note.startTimeSec > maxTime) break // Past scan zone
        if (note.startTimeSec >= minTime && expectedPitches.includes(note.pitch)) {
            matches.push({ pitch: note.pitch, time: note.startTimeSec, index: i })
        }
    }
    return matches.sort((a, b) => a.time - b.time)
}

/** Extract a chord cluster from the first match, removing matched pitches to prevent double-mapping */
function extractChord(
    expectedPitches: number[],
    midiNotes: NoteEvent[],
    startIndex: number,
    anchorTime: number,
    chordThreshold: number
): { notes: { pitch: number; time: number; index: number }[]; lastIndex: number } {
    const remaining = [...expectedPitches]
    const chordNotes: { pitch: number; time: number; index: number }[] = []
    let lastIndex = startIndex

    for (let i = startIndex; i < midiNotes.length; i++) {
        const note = midiNotes[i]
        // If we exceed the chord spread threshold, we've left the physical chord zone
        if (note.startTimeSec - anchorTime > chordThreshold) break

        const pitchIdx = remaining.indexOf(note.pitch)
        if (pitchIdx !== -1) {
            chordNotes.push({ pitch: note.pitch, time: note.startTimeSec, index: i })
            remaining.splice(pitchIdx, 1) // Prevent double-mapping same pitch
            lastIndex = i
        }
    }

    return { notes: chordNotes, lastIndex }
}

/**
 * Find the strongest chord candidate in a time window by maximizing matched expected pitches.
 * This is more stable than taking the very first pitch hit in ornament-heavy passages.
 */
function findBestChordMatchInWindow(
    expectedPitches: number[],
    midiNotes: NoteEvent[],
    startIndex: number,
    minTime: number,
    maxTime: number,
    chordThreshold: number,
    targetTime: number
): { anchorTime: number; chord: { notes: { pitch: number; time: number; index: number }[]; lastIndex: number } } | null {
    let best: { anchorTime: number; chord: { notes: { pitch: number; time: number; index: number }[]; lastIndex: number } } | null = null

    for (let i = startIndex; i < midiNotes.length; i++) {
        const note = midiNotes[i]
        if (note.startTimeSec > maxTime) break
        if (note.startTimeSec < minTime) continue
        if (!expectedPitches.includes(note.pitch)) continue

        const chord = extractChord(expectedPitches, midiNotes, i, note.startTimeSec, chordThreshold)
        if (!best) {
            best = { anchorTime: note.startTimeSec, chord }
        } else {
            const bestCount = best.chord.notes.length
            const currentCount = chord.notes.length
            const currentDistance = Math.abs(note.startTimeSec - targetTime)
            const bestDistance = Math.abs(best.anchorTime - targetTime)
            if (currentCount > bestCount || (currentCount === bestCount && currentDistance < bestDistance)) {
                best = { anchorTime: note.startTimeSec, chord }
            }
        }

        if (best && best.chord.notes.length >= expectedPitches.length) break
    }

    return best
}

/**
 * Continuity-constrained resync search.
 * Searches a bounded forward horizon and chooses the candidate that best
 * balances pitch coverage and temporal proximity to expectedTime.
 */
function findContinuityResyncMatch(
    expectedPitches: number[],
    midiNotes: NoteEvent[],
    startIndex: number,
    expectedTime: number,
    lastAnchorTime: number,
    expectedDelta: number,
    aqntl: number,
    chordThresholdFraction: number,
    beatsElapsed: number
): { anchorTime: number; chord: { notes: { pitch: number; time: number; index: number }[]; lastIndex: number } } | null {
    const chordThreshold = Math.max(0.100, aqntl * chordThresholdFraction)
    const nearLowerSlack = Math.max(0.08, expectedDelta * 0.40)
    const nearUpperSlack = Math.max(0.45, expectedDelta * 1.80)
    const maxForwardHorizon = Math.max(
        aqntl * 1.75,
        expectedDelta * 3.0,
        beatsElapsed >= 1 ? aqntl * 2.5 : aqntl * 2.0
    )
    const minTime = Math.max(lastAnchorTime, expectedTime - nearLowerSlack)
    const maxTime = expectedTime + Math.max(nearUpperSlack, maxForwardHorizon)

    let best: {
        anchorTime: number
        chord: { notes: { pitch: number; time: number; index: number }[]; lastIndex: number }
        score: number
    } | null = null

    for (let i = startIndex; i < midiNotes.length; i++) {
        const note = midiNotes[i]
        if (note.startTimeSec > maxTime) break
        if (note.startTimeSec < minTime) continue
        if (!expectedPitches.includes(note.pitch)) continue

        const chord = extractChord(expectedPitches, midiNotes, i, note.startTimeSec, chordThreshold)
        const coverage = chord.notes.length / Math.max(1, expectedPitches.length)
        const timingError = Math.abs(note.startTimeSec - expectedTime)
        const normalizedTimingError = timingError / Math.max(0.001, aqntl)
        const score = (1 - coverage) * 2.0 + normalizedTimingError

        if (!best || score < best.score) {
            best = { anchorTime: note.startTimeSec, chord, score }
        }

        if (coverage >= 1 && timingError <= Math.max(0.05, expectedDelta * 0.30)) {
            break
        }
    }

    return best ? { anchorTime: best.anchorTime, chord: best.chord } : null
}


// ─── Engine Functions ──────────────────────────────────────────────────

/**
 * Initialise V5 mapper. Applies audio offset, finds first pitch match.
 */
export function initV5(
    midiNotes: NoteEvent[],
    xmlEvents: XMLEvent[],
    _audioOffset: number = 0, // Kept for API compat but NOT used — V5 maps in MIDI time
    chordThresholdFraction: number = 0.0625 // 64th note default
): V5MapperState {
    const state: V5MapperState = {
        status: 'idle',
        currentEventIndex: 0,
        anchors: [],
        beatAnchors: [],
        ghostAnchor: null,
        aqntl: 0.5, // Default 120 BPM = 500ms per quarter note
        midiCursor: 0,
        chordThresholdFraction,
        lastAnchorTime: 0,
        lastAnchorGlobalBeat: 0,
        recentOutcomes: [],
        consecutiveMisses: 0,
    }

    if (midiNotes.length === 0 || xmlEvents.length === 0) {
        state.status = 'done'
        return state
    }

    // Sort MIDI by time
    const sorted = [...midiNotes].sort((a, b) => a.startTimeSec - b.startTimeSec)

    // Find first pitch match in MIDI (no audio offset — V5 works in MIDI time)
    const firstEvent = xmlEvents[0]
    const fermataCount = xmlEvents.filter(e => e.hasFermata).length
    debug.log(`[V5 DEBUG] Total XML events: ${xmlEvents.length}, fermatas: ${fermataCount}`)
    if (fermataCount > 0) {
        debug.log(`[V5 DEBUG] Fermata events:`, xmlEvents.filter(e => e.hasFermata).map(e => `M${e.measure} B${e.beat}`).join(', '))
    }
    debug.log(`[V5 DEBUG] First 5 XML events:`, xmlEvents.slice(0, 5).map(e => `M${e.measure} B${e.beat} pitches=[${e.pitches.join(',')}]`).join(' | '))
    debug.log(`[V5 DEBUG] First 10 MIDI notes (pitch):`, sorted.slice(0, 10).map(n => n.pitch).join(','))
    debug.log(`[V5 DEBUG] First 10 MIDI notes (time):`, sorted.slice(0, 10).map(n => n.startTimeSec.toFixed(3)).join(','))
    debug.log(`[V5 DEBUG] Seeking first match for: M${firstEvent.measure} B${firstEvent.beat} pitches=[${firstEvent.pitches.join(',')}]`)

    const firstMatch = findFirstPitchMatch(firstEvent.pitches, sorted, 0)

    if (!firstMatch) {
        console.warn('[V5] Could not find first pitch match in MIDI. Mapper cannot start.')
        state.status = 'done'
        return state
    }

    // Record first anchor at MIDI-native timestamp (no shift)
    const firstAnchorTime = firstMatch.time
    const chordThreshold = state.aqntl * chordThresholdFraction
    const chord = extractChord(firstEvent.pitches, sorted, firstMatch.index, firstMatch.time, chordThreshold)

    state.anchors.push({ measure: firstEvent.measure, time: firstAnchorTime })
    if (firstEvent.beat > 1.01) {
        state.beatAnchors.push({ measure: firstEvent.measure, beat: firstEvent.beat, time: firstAnchorTime })
    }

    state.lastAnchorTime = firstAnchorTime
    state.lastAnchorGlobalBeat = firstEvent.globalBeat
    state.midiCursor = chord.lastIndex + 1
    state.currentEventIndex = 1 // Move past first event
    state.status = state.currentEventIndex >= xmlEvents.length ? 'done' : 'running'

    debug.log(`[V5] Initialised (MIDI time). First anchor at ${firstAnchorTime.toFixed(3)}s (M${firstEvent.measure} B${firstEvent.beat}). AQNTL=${state.aqntl.toFixed(3)}s. Chord threshold=${chordThresholdFraction}`)

    return state
}

/**
 * Expand a MIDI pitch list to include all octave variants within the piano range [21, 108].
 * Used as a last-resort fallback when the performer plays notes in the wrong octave
 * (e.g. C#1+C#2 instead of the written C#2+C#3). Pitch-class identity (note % 12)
 * is preserved; only the octave number differs.
 */
function expandToOctaveEquivalents(pitches: number[]): number[] {
    const expanded = new Set<number>(pitches)
    for (const p of pitches) {
        for (let shift = -48; shift <= 48; shift += 12) {
            const eq = p + shift
            if (eq >= 21 && eq <= 108) expanded.add(eq)
        }
    }
    return [...expanded]
}

/**
 * Expand a MIDI pitch list to include ±1 semitone neighbors within piano range [21, 108].
 * Used as a last-resort fallback when the performer plays a wrong accidental
 * (e.g. C# instead of C♮, or B♭ instead of B♮). Only shifts by ±1 semitone —
 * does NOT expand octaves (kept specific to avoid false positives).
 */
function expandToSemitoneNeighbors(pitches: number[]): number[] {
    const expanded = new Set<number>(pitches)
    for (const p of pitches) {
        for (const shift of [-1, 1]) {
            const neighbor = p + shift
            if (neighbor >= 21 && neighbor <= 108) expanded.add(neighbor)
        }
    }
    return [...expanded]
}

/**
 * Process the next xmlEvent. Returns updated state.
 * - Match found → status stays 'running', anchors updated
 * - No match → status = 'paused', ghostAnchor placed
 */
export function stepV5(
    state: V5MapperState,
    midiNotes: NoteEvent[],
    xmlEvents: XMLEvent[]
): V5MapperState {
    if (state.status !== 'running' || state.currentEventIndex >= xmlEvents.length) {
        return { ...state, status: 'done' }
    }

    const sorted = [...midiNotes].sort((a, b) => a.startTimeSec - b.startTimeSec)

    // Stop dead-reckoning past the MIDI duration — no more notes to match against
    const midiDuration = sorted.length > 0 ? sorted[sorted.length - 1].startTimeSec : 0
    if (state.midiCursor >= sorted.length && state.lastAnchorTime > midiDuration) {
        debug.log(`[V5] Stopping: past MIDI duration (lastAnchor=${state.lastAnchorTime.toFixed(3)}s, midiDuration=${midiDuration.toFixed(3)}s, remaining XML events=${xmlEvents.length - state.currentEventIndex})`)
        return { ...state, status: 'done' }
    }

    const xmlEvent = xmlEvents[state.currentEventIndex]

    // Calculate scan window using beatsElapsed
    const beatsElapsed = xmlEvent.globalBeat - state.lastAnchorGlobalBeat
    if (beatsElapsed <= 0) {
        // Same beat position — skip (shouldn't happen with well-formed XML)
        console.warn(`[V5] beatsElapsed <= 0 at event ${state.currentEventIndex}, skipping`)
        return {
            ...state,
            currentEventIndex: state.currentEventIndex + 1,
            straySkipCursor: undefined, // Reset on event advancement
            status: state.currentEventIndex + 1 >= xmlEvents.length ? 'done' : 'running',
        }
    }

    const expectedDelta = beatsElapsed * state.aqntl
    const expectedTime = state.lastAnchorTime + expectedDelta
    const buffer = expectedDelta * 0.20
    const searchStart = state.lastAnchorTime - buffer * 0.5 // Allow slight early arrival
    const searchEnd = state.lastAnchorTime + expectedDelta + buffer
    const preserveTempoEstimate = beatsElapsed < 1 || (xmlEvent.smallestDuration ?? 1) <= 0.25

    // Use the higher of midiCursor or straySkipCursor as the scan start.
    // straySkipCursor advances past rejected stray clusters during retry loops
    // WITHOUT permanently moving midiCursor past valid notes.
    const scanStartIndex = Math.max(state.midiCursor, state.straySkipCursor ?? 0)

    v5LogFor(xmlEvent,
        `[V5 STEP] idx=${state.currentEventIndex} M${xmlEvent.measure} B${xmlEvent.beat} ` +
        `expPitches=[${xmlEvent.pitches.join(',')}] beatsElapsed=${beatsElapsed.toFixed(3)} ` +
        `aqntl=${state.aqntl.toFixed(3)} window=[${searchStart.toFixed(3)},${searchEnd.toFixed(3)}] ` +
        `cursor=${state.midiCursor} strayCursor=${state.straySkipCursor ?? 'none'} scanStart=${scanStartIndex} misses=${state.consecutiveMisses}`
    )
    v5LogFor(xmlEvent, `[V5 STEP DETAIL] expectedTime=${expectedTime.toFixed(3)} preserveTempo=${preserveTempoEstimate} afterFermata=${!!state.afterFermata} isTied=${!!xmlEvent.isTiedContinuation}`)

    // ─── TIED-CONTINUATION FAST PATH ───
    // All notes at this beat are tied from the previous measure — no new MIDI note-on
    // will occur. Dead-reckon immediately WITHOUT incrementing consecutiveMisses so
    // we don't burn the continuity-resync budget on expected-absent onsets.
    if (xmlEvent.isTiedContinuation) {
        const deadReckonTime = state.lastAnchorTime + expectedDelta
        const nextIndex = state.currentEventIndex + 1
        const newAnchors = [...state.anchors]
        const isNewMeasure = newAnchors.length === 0 || newAnchors[newAnchors.length - 1].measure !== xmlEvent.measure
        if (isNewMeasure) newAnchors.push({ measure: xmlEvent.measure, time: deadReckonTime })
        v5LogFor(xmlEvent,
            `[V5] ⏭ Tied-continuation M${xmlEvent.measure} B${xmlEvent.beat}: ` +
            `dead-reckoning to ${deadReckonTime.toFixed(3)}s (no new MIDI onset expected)`
        )
        return {
            ...state,
            anchors: newAnchors,
            currentEventIndex: nextIndex,
            lastAnchorTime: deadReckonTime,
            lastAnchorGlobalBeat: xmlEvent.globalBeat,
            straySkipCursor: undefined,
            // consecutiveMisses unchanged — tied notes are not mapping failures
            recentOutcomes: pushOutcome(state.recentOutcomes, 'dead-reckon'),
            afterTiedSequence: true, // Next real event must do a fresh scan
            status: nextIndex >= xmlEvents.length ? 'done' : 'running',
        }
    }

    // ─── AFTER-TIED-SEQUENCE FRESH SCAN ───
    // We just processed one or more tied-continuation events. AQNTL has NOT been
    // calibrated from real note matches yet, so the dead-reckoned expectedTime is
    // unreliable. Do an unconstrained forward pitch scan from midiCursor to find
    // where the performer actually played this event.
    // Classic case: Fantaisie Impromptu M1+M2 are tied G# pedal tones; AQNTL=0.5
    // dead-reckons M3 to ~2.3s but the actual notes land at ~4.96s.
    if (state.afterTiedSequence && !xmlEvent.isTiedContinuation) {
        const freshMatch = findFirstPitchMatch(xmlEvent.pitches, sorted, state.midiCursor)
        v5LogFor(xmlEvent, `[V5 AFTER-TIE] fresh scan from cursor=${state.midiCursor}: ${freshMatch ? `match at ${freshMatch.time.toFixed(3)}s` : 'no match'}`)

        if (freshMatch) {
            const chordThreshold = Math.max(0.100, state.aqntl * state.chordThresholdFraction)
            const chord = extractChord(xmlEvent.pitches, sorted, freshMatch.index, freshMatch.time, chordThreshold)

            // Calibrate AQNTL from the first real match after tied opening.
            // Use the first xmlEvent's globalBeat as origin (it's always 0 for the first event).
            const firstEventGlobalBeat = xmlEvents[0]?.globalBeat ?? 0
            const firstAnchorTime = state.anchors[0]?.time ?? 0
            const totalBeatsFromStart = xmlEvent.globalBeat - firstEventGlobalBeat
            const totalTimeFromStart = freshMatch.time - firstAnchorTime
            if (totalBeatsFromStart > 0 && totalTimeFromStart > 0) {
                const calibratedAqntl = totalTimeFromStart / totalBeatsFromStart
                // Blend with prior AQNTL (trust new data heavily since it's a real match)
                const blendedAqntl = state.aqntl * 0.2 + calibratedAqntl * 0.8
                state = { ...state, aqntl: Math.max(0.1, Math.min(2.0, blendedAqntl)) }
                v5LogFor(xmlEvent, `[V5 AFTER-TIE] AQNTL calibrated: ${state.aqntl.toFixed(3)}s (from ${totalBeatsFromStart.toFixed(1)} beats, ${totalTimeFromStart.toFixed(3)}s elapsed)`)
            }

            const newAnchors = [...state.anchors]
            const newBeatAnchors = [...state.beatAnchors]
            const isNewMeasure = state.anchors.length === 0 || state.anchors[state.anchors.length - 1].measure !== xmlEvent.measure
            if (isNewMeasure) newAnchors.push({ measure: xmlEvent.measure, time: freshMatch.time })
            if (xmlEvent.beat > 1.01) newBeatAnchors.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: freshMatch.time })

            const nextIndex = state.currentEventIndex + 1
            v5LogFor(xmlEvent, `[V5] 🎵 Post-tie fresh match M${xmlEvent.measure} B${xmlEvent.beat} → ${freshMatch.time.toFixed(3)}s | pitches=[${chord.notes.map(n => n.pitch)}] aqntl=${state.aqntl.toFixed(3)}`)

            return {
                ...state,
                anchors: newAnchors,
                beatAnchors: newBeatAnchors,
                ghostAnchor: null,
                midiCursor: chord.lastIndex + 1,
                currentEventIndex: nextIndex,
                lastAnchorTime: freshMatch.time,
                lastAnchorGlobalBeat: xmlEvent.globalBeat,
                lastRealMatchTime: freshMatch.time,
                afterTiedSequence: false, // Cleared: AQNTL now calibrated
                consecutiveMisses: 0,
                recentOutcomes: pushOutcome(state.recentOutcomes, 'match'),
                status: nextIndex >= xmlEvents.length ? 'done' : 'running',
            }
        }
        // No match found at all (unusual) — fall through to normal window logic
        v5LogFor(xmlEvent, `[V5 AFTER-TIE] No match found in fresh scan; falling through to normal logic`)
    }

    // ─── AFTER-FERMATA FRESH SCAN ───
    // If the previous beat had a fermata, the performer held it for an unpredictable duration.
    // Ignore AQNTL window and do a fresh pitch search to re-sync.
    if (state.afterFermata) {
        const freshMatch = findFirstPitchMatch(xmlEvent.pitches, sorted, state.midiCursor)
        v5LogFor(xmlEvent, `[V5 AFTER-FERMATA] freshMatch=${freshMatch ? `{t:${freshMatch.time.toFixed(3)},i:${freshMatch.index}}` : 'none'}`)

        if (freshMatch) {
            const chordThreshold = Math.max(0.100, state.aqntl * state.chordThresholdFraction)
            const chord = extractChord(xmlEvent.pitches, sorted, freshMatch.index, freshMatch.time, chordThreshold)

            const newAnchors = [...state.anchors]
            const newBeatAnchors = [...state.beatAnchors]
            const isNewMeasure = state.anchors.length === 0 || state.anchors[state.anchors.length - 1].measure !== xmlEvent.measure
            if (isNewMeasure) newAnchors.push({ measure: xmlEvent.measure, time: freshMatch.time })
            if (xmlEvent.beat > 1.01) newBeatAnchors.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: freshMatch.time })

            const nextIndex = state.currentEventIndex + 1

            v5LogFor(xmlEvent, `[V5] 🎵 Post-fermata fresh match M${xmlEvent.measure} B${xmlEvent.beat} → ${freshMatch.time.toFixed(3)}s | pitches=[${chord.notes.map(n => n.pitch)}]`)

            return {
                ...state,
                anchors: newAnchors,
                beatAnchors: newBeatAnchors,
                ghostAnchor: null,
                aqntl: state.aqntl, // Preserve AQNTL — don't let fermata timing corrupt it
                midiCursor: chord.lastIndex + 1,
                currentEventIndex: nextIndex,
                lastAnchorTime: freshMatch.time,
                lastAnchorGlobalBeat: xmlEvent.globalBeat,
                afterFermata: false, // Re-synced
                consecutiveMisses: 0,
                recentOutcomes: pushOutcome(state.recentOutcomes, 'match'),
                status: nextIndex >= xmlEvents.length ? 'done' : 'running',
            }
        } else {
            // No match yet — dead-reckon this beat (held note under fermata)
            const deadReckonTime = state.lastAnchorTime + expectedDelta
            const nextIndex = state.currentEventIndex + 1

            v5LogFor(xmlEvent, `[V5] 🎵 Post-fermata dead-reckon M${xmlEvent.measure} B${xmlEvent.beat} → ${deadReckonTime.toFixed(3)}s (no onset, still seeking)`)

            const newAnchors = [...state.anchors]
            const newBeatAnchors = [...state.beatAnchors]
            const isNewMeasure = state.anchors.length === 0 || state.anchors[state.anchors.length - 1].measure !== xmlEvent.measure
            if (isNewMeasure) newAnchors.push({ measure: xmlEvent.measure, time: deadReckonTime })
            if (xmlEvent.beat > 1.01) newBeatAnchors.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: deadReckonTime })

            return {
                ...state,
                anchors: newAnchors,
                beatAnchors: newBeatAnchors,
                ghostAnchor: null,
                currentEventIndex: nextIndex,
                lastAnchorTime: deadReckonTime,
                lastAnchorGlobalBeat: xmlEvent.globalBeat,
                // Keep afterFermata = true until we find a real match
                recentOutcomes: pushOutcome(state.recentOutcomes, 'dead-reckon'),
                status: nextIndex >= xmlEvents.length ? 'done' : 'running',
            }
        }
    }

    // ─── CONSECUTIVE MISS FRESH SCAN ───
    // If 3+ consecutive non-matches (dead-reckons/strays), switch to fresh scanning.
    // This handles fermatas, ritardandos, and any timing disruption dynamically.
    if (state.consecutiveMisses >= 3) {
        v5LogFor(xmlEvent, `[V5] 🔍 Fresh scan activated (${state.consecutiveMisses} consecutive misses). Looking for M${xmlEvent.measure} B${xmlEvent.beat} pitches=[${xmlEvent.pitches}] from scanStart=${scanStartIndex}`)
        const freshResync = findContinuityResyncMatch(
            xmlEvent.pitches,
            sorted,
            scanStartIndex,
            expectedTime,
            state.lastAnchorTime,
            expectedDelta,
            state.aqntl,
            state.chordThresholdFraction,
            beatsElapsed
        )
        v5LogFor(xmlEvent, `[V5 FRESH-SCAN] candidate=${freshResync ? `{t:${freshResync.anchorTime.toFixed(3)},i:${freshResync.chord.lastIndex}}` : 'none'}`)

        if (freshResync) {
            // Found a match anywhere ahead — re-sync!
            const chord = freshResync.chord
            const anchorTime = freshResync.anchorTime

            const newAnchors = [...state.anchors]
            const newBeatAnchors = [...state.beatAnchors]
            const isNewMeasure = state.anchors.length === 0 || state.anchors[state.anchors.length - 1].measure !== xmlEvent.measure
            if (isNewMeasure) newAnchors.push({ measure: xmlEvent.measure, time: anchorTime })
            if (xmlEvent.beat > 1.01) newBeatAnchors.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: anchorTime })

            const nextIndex = state.currentEventIndex + 1

            v5LogFor(xmlEvent, `[V5] 🔄 Fresh-scan re-sync M${xmlEvent.measure} B${xmlEvent.beat} → ${anchorTime.toFixed(3)}s | pitches=[${chord.notes.map(n => n.pitch)}] (after ${state.consecutiveMisses} misses)`)

            return {
                ...state,
                anchors: newAnchors,
                beatAnchors: newBeatAnchors,
                ghostAnchor: null,
                aqntl: state.aqntl, // Don't update AQNTL from disrupted timing
                midiCursor: chord.lastIndex + 1,
                straySkipCursor: undefined, // Reset: we found a real match
                currentEventIndex: nextIndex,
                lastAnchorTime: anchorTime,
                lastAnchorGlobalBeat: xmlEvent.globalBeat,
                consecutiveMisses: 0, // Re-synced!
                recentOutcomes: pushOutcome(state.recentOutcomes, 'match'),
                status: nextIndex >= xmlEvents.length ? 'done' : 'running',
            }
        } else {
            v5LogFor(xmlEvent, `[V5] 🔍 Fresh scan found NO match for pitches=[${xmlEvent.pitches}]. Falling through to normal flow.`)
        }
        // No fresh match either — continue to normal flow (will dead-reckon or pause)
    }

    // Scan for pitch matches in window
    const matches = scanWindow(xmlEvent.pitches, sorted, scanStartIndex, searchStart, searchEnd)
    v5LogFor(xmlEvent, `[V5 WINDOW] matches=${matches.length} sample=${previewCandidates(matches)}`)

    if (matches.length > 0) {
        // --- MATCH FOUND ---
        // Chord threshold: user-configured fraction of AQNTL, but at least 100ms for rolled chords
        const chordThreshold = Math.max(0.100, state.aqntl * state.chordThresholdFraction)
        const bestWindowMatch = findBestChordMatchInWindow(
            xmlEvent.pitches,
            sorted,
            scanStartIndex,
            searchStart,
            searchEnd,
            chordThreshold,
            expectedTime
        )
        const anchorTime = bestWindowMatch ? bestWindowMatch.anchorTime : matches[0].time
        const chord = bestWindowMatch
            ? bestWindowMatch.chord
            : extractChord(xmlEvent.pitches, sorted, matches[0].index, anchorTime, chordThreshold)
        v5LogFor(xmlEvent,
            `[V5 WINDOW CHOOSE] anchor=${anchorTime.toFixed(3)} ` +
            `chordMatches=${chord.notes.length}/${xmlEvent.pitches.length} ` +
            `bestWindowMatch=${bestWindowMatch ? 'yes' : 'no'} ` +
            `pitches=[${chord.notes.map(n => n.pitch).join(',')}]`
        )

        // Match quality check: if we only matched a small fraction of expected pitches,
        // this is likely a stray note from a rolled chord bleeding into the next beat.
        // Skip it and continue scanning from after this stray note.
        const expectedCount = xmlEvent.pitches.length
        const matchedCount = chord.notes.length
        const matchRatio = matchedCount / expectedCount
        const isDensePassage = beatsElapsed <= 0.5 || (xmlEvent.smallestDuration ?? 1) <= 0.25
        const isLargeChordPassage = expectedCount >= 4
        const isRecoveryCandidate = matchedCount > 0 && (isDensePassage || isLargeChordPassage || state.consecutiveMisses >= 1)

        if (expectedCount >= 3 && matchRatio < 0.5) {
            v5LogFor(xmlEvent, `[V5 LOW-RATIO] matched=${matchedCount}/${expectedCount} ratio=${matchRatio.toFixed(3)} dense=${isDensePassage} largeChord=${isLargeChordPassage}`)
            if (isRecoveryCandidate) {
                const recoveryTime = chord.notes[0].time
                const newAnchors = [...state.anchors]
                const newBeatAnchors = [...state.beatAnchors]
                const isNewMeasure = state.anchors.length === 0 || state.anchors[state.anchors.length - 1].measure !== xmlEvent.measure
                if (isNewMeasure) newAnchors.push({ measure: xmlEvent.measure, time: recoveryTime })
                if (xmlEvent.beat > 1.01) newBeatAnchors.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: recoveryTime })

                const nextIndex = state.currentEventIndex + 1
                v5LogFor(xmlEvent,
                    `[V5] ⚡ Partial-chord recovery M${xmlEvent.measure} B${xmlEvent.beat}: ` +
                    `${matchedCount}/${expectedCount} pitches=[${chord.notes.map(n => n.pitch).join(',')}], ` +
                    `dense=${isDensePassage} largeChord=${isLargeChordPassage} misses=${state.consecutiveMisses}, ` +
                    `anchoring at ${recoveryTime.toFixed(3)}s and advancing.`
                )

                return {
                    ...state,
                    anchors: newAnchors,
                    beatAnchors: newBeatAnchors,
                    ghostAnchor: null,
                    aqntl: state.aqntl,
                    midiCursor: chord.lastIndex + 1,
                    straySkipCursor: undefined, // Reset: partial-chord recovery counts as advancement
                    currentEventIndex: nextIndex,
                    lastAnchorTime: recoveryTime,
                    lastAnchorGlobalBeat: xmlEvent.globalBeat,
                    consecutiveMisses: 0,
                    recentOutcomes: pushOutcome(state.recentOutcomes, 'match'),
                    status: nextIndex >= xmlEvents.length ? 'done' : 'running',
                }
            }

            v5LogFor(xmlEvent, `[V5] ⚠ Stray note at M${xmlEvent.measure} B${xmlEvent.beat}: only ${matchedCount}/${expectedCount} pitches matched (${chord.notes.map(n => n.pitch).join(',')}). Skipping. [misses=${state.consecutiveMisses + 1}]`)

            // Track outcome and check for accuracy drop
            const outcomes = pushOutcome(state.recentOutcomes, 'stray')
            const badCount = outcomes.filter(o => o !== 'match').length
            v5LogFor(xmlEvent, `[V5 STRAY] outcomes=${outcomes.join(',')} bad=${badCount}/${outcomes.length} accuracy=${Math.round((1 - badCount / Math.max(1, outcomes.length)) * 100)}%`)
            if (isRunaway(outcomes)) {
                // Accuracy dropped below 80% over last 20 events — stop cleanly.
                // Do NOT add more anchors from this point; everything up to here is reliable.
                v5Log(`[V5] 🛑 Stopping at M${xmlEvent.measure} B${xmlEvent.beat}: accuracy ${Math.round((1 - badCount / outcomes.length) * 100)}% over last ${outcomes.length} events (threshold 80%). Mapped ${state.anchors.length} measure anchors reliably.`)
                return {
                    ...state,
                    recentOutcomes: outcomes,
                    ghostAnchor: null,
                    consecutiveMisses: 0,
                    straySkipCursor: undefined,
                    status: 'done', // Stop — anchors so far are reliable, don't cascade bad data
                }
            }

            // *** THE KEY FIX ***
            // Advance straySkipCursor (not midiCursor) past this stray cluster.
            // midiCursor stays at its current position so the next scan attempt
            // for this same XML event can still find valid notes within the correct
            // time window. straySkipCursor ensures we don't re-examine this stray.
            return {
                ...state,
                recentOutcomes: outcomes,
                consecutiveMisses: state.consecutiveMisses + 1,
                straySkipCursor: Math.max(state.straySkipCursor ?? 0, chord.lastIndex + 1),
                // midiCursor intentionally NOT advanced — re-try same XML event from here
                // Don't advance currentEventIndex — re-try this same XML event
            }
        }

        // Build new anchors
        const newAnchors = [...state.anchors]
        const newBeatAnchors = [...state.beatAnchors]

        // Measure anchor (only if this is beat 1 of a new measure)
        const isNewMeasure = state.anchors.length === 0 || state.anchors[state.anchors.length - 1].measure !== xmlEvent.measure
        if (isNewMeasure) {
            newAnchors.push({ measure: xmlEvent.measure, time: anchorTime })
        }

        // Beat anchor (for fractional beats > 1)
        if (xmlEvent.beat > 1.01) {
            newBeatAnchors.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: anchorTime })
        }

        // Update AQNTL with exponential moving average (70/30 smoothing)
        const actualDelta = anchorTime - state.lastAnchorTime
        const instantAqntl = actualDelta / beatsElapsed
        const newAqntl = preserveTempoEstimate
            ? state.aqntl
            : (state.aqntl * 0.7) + (instantAqntl * 0.3)

        const nextIndex = state.currentEventIndex + 1

        // Advance midiCursor past the matched chord cluster AND any lingering notes
        // within the chord-threshold window. This prevents the next event's scan from
        // reaching back into the same cluster when the same pitch recurs immediately
        // (e.g. repeated C#4 downbeats in Fantaisie Impromptu LH after decimation).
        const chordWindowEnd = anchorTime + Math.max(0.100, newAqntl * state.chordThresholdFraction)
        let postChordCursor = chord.lastIndex + 1
        while (postChordCursor < sorted.length && sorted[postChordCursor].startTimeSec <= chordWindowEnd) {
            postChordCursor++
        }

        v5LogFor(xmlEvent, `[V5] ✓ M${xmlEvent.measure} B${xmlEvent.beat} → ${anchorTime.toFixed(3)}s | matched ${matchedCount}/${expectedCount} pitches=[${chord.notes.map(n => n.pitch)}] | AQNTL=${newAqntl.toFixed(3)}s (${(60 / newAqntl).toFixed(1)} BPM)${preserveTempoEstimate ? ' [tempo held]' : ''} | cursor ${chord.lastIndex + 1}→${postChordCursor}`)

        return {
            ...state,
            anchors: newAnchors,
            beatAnchors: newBeatAnchors,
            ghostAnchor: null,
            aqntl: newAqntl,
            midiCursor: postChordCursor,
            straySkipCursor: undefined, // Reset: confirmed match, clean slate for next event
            currentEventIndex: nextIndex,
            lastAnchorTime: anchorTime,
            lastAnchorGlobalBeat: xmlEvent.globalBeat,
            afterFermata: xmlEvent.hasFermata || false,
            consecutiveMisses: 0, // Reset on successful match
            recentOutcomes: pushOutcome(state.recentOutcomes, 'match'),
            status: nextIndex >= xmlEvents.length ? 'done' : 'running',
        }
    } else {
        // --- NO MATCH ---
        // Before pausing, try a wider scan (±50% buffer instead of 20%)
        const wideBuffer = expectedDelta * 0.50
        const wideStart = state.lastAnchorTime - wideBuffer * 0.5
        const wideEnd = state.lastAnchorTime + expectedDelta + wideBuffer
        const wideMatches = scanWindow(xmlEvent.pitches, sorted, scanStartIndex, wideStart, wideEnd)
        v5LogFor(xmlEvent, `[V5 WIDE] window=[${wideStart.toFixed(3)},${wideEnd.toFixed(3)}] matches=${wideMatches.length} sample=${previewCandidates(wideMatches)}`)

        if (wideMatches.length > 0) {
            // Found with wider window — proceed as normal match
            const chordThreshold = Math.max(0.100, state.aqntl * state.chordThresholdFraction)
            const bestWideMatch = findBestChordMatchInWindow(
                xmlEvent.pitches,
                sorted,
                scanStartIndex,
                wideStart,
                wideEnd,
                chordThreshold,
                expectedTime
            )
            const anchorTime = bestWideMatch ? bestWideMatch.anchorTime : wideMatches[0].time
            const chord = bestWideMatch
                ? bestWideMatch.chord
                : extractChord(xmlEvent.pitches, sorted, wideMatches[0].index, anchorTime, chordThreshold)
            v5LogFor(xmlEvent,
                `[V5 WIDE CHOOSE] anchor=${anchorTime.toFixed(3)} ` +
                `chordMatches=${chord.notes.length}/${xmlEvent.pitches.length} ` +
                `bestWideMatch=${bestWideMatch ? 'yes' : 'no'} ` +
                `pitches=[${chord.notes.map(n => n.pitch).join(',')}]`
            )

            const newAnchors = [...state.anchors]
            const newBeatAnchors = [...state.beatAnchors]
            const isNewMeasure = state.anchors.length === 0 || state.anchors[state.anchors.length - 1].measure !== xmlEvent.measure
            if (isNewMeasure) newAnchors.push({ measure: xmlEvent.measure, time: anchorTime })
            if (xmlEvent.beat > 1.01) newBeatAnchors.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: anchorTime })

            const actualDelta = anchorTime - state.lastAnchorTime
            const instantAqntl = actualDelta / beatsElapsed
            const newAqntl = preserveTempoEstimate
                ? state.aqntl
                : (state.aqntl * 0.7) + (instantAqntl * 0.3)
            const nextIndex = state.currentEventIndex + 1

            v5LogFor(xmlEvent, `[V5] ✓ M${xmlEvent.measure} B${xmlEvent.beat} → ${anchorTime.toFixed(3)}s (wide scan) | AQNTL=${newAqntl.toFixed(3)}s${xmlEvent.hasFermata ? ' 🎵FERMATA→afterFermata=true' : ''}${preserveTempoEstimate ? ' [tempo held]' : ''}`)

            return {
                ...state,
                anchors: newAnchors,
                beatAnchors: newBeatAnchors,
                ghostAnchor: null,
                aqntl: newAqntl,
                midiCursor: chord.lastIndex + 1,
                straySkipCursor: undefined, // Reset: wide-scan match, clean slate
                currentEventIndex: nextIndex,
                lastAnchorTime: anchorTime,
                lastAnchorGlobalBeat: xmlEvent.globalBeat,
                afterFermata: xmlEvent.hasFermata || false,
                consecutiveMisses: 0,
                recentOutcomes: pushOutcome(state.recentOutcomes, 'match'),
                status: nextIndex >= xmlEvents.length ? 'done' : 'running',
            }
        }

        // ─── NO MATCH: FRESH SCAN FIRST, DEAD-RECKON AS FALLBACK ───
        // Try a fresh pitch search from midiCursor (anywhere ahead).
        // If found: verified anchor, no cascading errors.
        // If not found: dead-reckon (held note/rest with no new onset).
        const freshResync = findContinuityResyncMatch(
            xmlEvent.pitches,
            sorted,
            scanStartIndex,
            expectedTime,
            state.lastAnchorTime,
            expectedDelta,
            state.aqntl,
            state.chordThresholdFraction,
            beatsElapsed
        )
        const deadReckonTime = state.lastAnchorTime + expectedDelta
        v5LogFor(xmlEvent, `[V5 FALLBACK] freshMatch=${freshResync ? `{t:${freshResync.anchorTime.toFixed(3)},i:${freshResync.chord.lastIndex}}` : 'none'} deadReckon=${deadReckonTime.toFixed(3)}`)

        if (freshResync) {
            // Fresh scan found a match! Use it as a verified anchor.
            const chord = freshResync.chord
            const anchorTime = freshResync.anchorTime

            const newAnchors = [...state.anchors]
            const newBeatAnchors = [...state.beatAnchors]
            const isNewMeasure = state.anchors.length === 0 || state.anchors[state.anchors.length - 1].measure !== xmlEvent.measure
            if (isNewMeasure) newAnchors.push({ measure: xmlEvent.measure, time: anchorTime })
            if (xmlEvent.beat > 1.01) newBeatAnchors.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: anchorTime })

            const nextIndex = state.currentEventIndex + 1

            v5LogFor(xmlEvent, `[V5] 🔄 Fresh-scan match M${xmlEvent.measure} B${xmlEvent.beat} → ${anchorTime.toFixed(3)}s | pitches=[${chord.notes.map(n => n.pitch)}] (window missed, continuity-resync found)`)

            return {
                ...state,
                anchors: newAnchors,
                beatAnchors: newBeatAnchors,
                ghostAnchor: null,
                aqntl: state.aqntl, // Don't update AQNTL from out-of-window timing
                midiCursor: chord.lastIndex + 1,
                straySkipCursor: undefined, // Reset: continuity-resync match found
                currentEventIndex: nextIndex,
                lastAnchorTime: anchorTime,
                lastAnchorGlobalBeat: xmlEvent.globalBeat,
                afterFermata: xmlEvent.hasFermata || false,
                consecutiveMisses: 0,
                recentOutcomes: pushOutcome(state.recentOutcomes, 'match'),
                status: nextIndex >= xmlEvents.length ? 'done' : 'running',
            }
        }

        // ─── OCTAVE-EQUIVALENT FALLBACK ───
        // The performer may have played the right pitch class but in the wrong octave
        // (e.g. C#1+C#2 instead of C#2+C#3). Expand the expected pitches to all octave
        // variants within piano range and retry the continuity resync once.
        if (xmlEvent.pitches.length > 0) {
            const octavePitches = expandToOctaveEquivalents(xmlEvent.pitches)
            if (octavePitches.length > xmlEvent.pitches.length) {
                const octaveResync = findContinuityResyncMatch(
                    octavePitches,
                    sorted,
                    scanStartIndex,
                    expectedTime,
                    state.lastAnchorTime,
                    expectedDelta,
                    state.aqntl,
                    state.chordThresholdFraction,
                    beatsElapsed
                )
                if (octaveResync) {
                    const chord = octaveResync.chord
                    const anchorTime = octaveResync.anchorTime
                    const newAnchorsOct = [...state.anchors]
                    const newBeatAnchorsOct = [...state.beatAnchors]
                    const isNewMeasureOct = newAnchorsOct.length === 0 || newAnchorsOct[newAnchorsOct.length - 1].measure !== xmlEvent.measure
                    if (isNewMeasureOct) newAnchorsOct.push({ measure: xmlEvent.measure, time: anchorTime })
                    if (xmlEvent.beat > 1.01) newBeatAnchorsOct.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: anchorTime })
                    const nextIndexOct = state.currentEventIndex + 1
                    v5LogFor(xmlEvent,
                        `[V5] 🎵 Octave-equiv resync M${xmlEvent.measure} B${xmlEvent.beat} → ${anchorTime.toFixed(3)}s | ` +
                        `matched MIDI pitch(es)=[${chord.notes.map(n => n.pitch).join(',')}] ` +
                        `(expected=[${xmlEvent.pitches.join(',')}], expanded=[${octavePitches.join(',')}])`
                    )
                    return {
                        ...state,
                        anchors: newAnchorsOct,
                        beatAnchors: newBeatAnchorsOct,
                        ghostAnchor: null,
                        aqntl: state.aqntl, // Don't update AQNTL from an octave-shifted match
                        midiCursor: chord.lastIndex + 1,
                        straySkipCursor: undefined,
                        currentEventIndex: nextIndexOct,
                        lastAnchorTime: anchorTime,
                        lastAnchorGlobalBeat: xmlEvent.globalBeat,
                        afterFermata: xmlEvent.hasFermata || false,
                        consecutiveMisses: 0,
                        recentOutcomes: pushOutcome(state.recentOutcomes, 'match'),
                        status: nextIndexOct >= xmlEvents.length ? 'done' : 'running',
                    }
                }
                v5LogFor(xmlEvent, `[V5 OCTAVE-FALLBACK] No match even with octave expansion -> trying semitone neighbor fallback`)
            }
        }

        // ─── SEMITONE-NEIGHBOR FALLBACK ───
        // The performer may have played a wrong accidental (±1 semitone misplay),
        // e.g. C# instead of the written C♮. This handles that without cascading
        // dead-reckoning errors. Only kicks in after exact + octave fallbacks fail.
        const semitoneExpanded = expandToSemitoneNeighbors(xmlEvent.pitches)
        if (semitoneExpanded.length > xmlEvent.pitches.length) {
            const semitoneResync = findContinuityResyncMatch(
                semitoneExpanded,
                sorted,
                scanStartIndex,
                expectedTime,
                state.lastAnchorTime,
                expectedDelta,
                state.aqntl,
                state.chordThresholdFraction,
                beatsElapsed
            )
            if (semitoneResync) {
                const chord = semitoneResync.chord
                const anchorTime = semitoneResync.anchorTime
                const newAnchorsST = [...state.anchors]
                const newBeatAnchorsST = [...state.beatAnchors]
                const isNewMeasureST = newAnchorsST.length === 0 || newAnchorsST[newAnchorsST.length - 1].measure !== xmlEvent.measure
                if (isNewMeasureST) newAnchorsST.push({ measure: xmlEvent.measure, time: anchorTime })
                if (xmlEvent.beat > 1.01) newBeatAnchorsST.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: anchorTime })
                const nextIndexST = state.currentEventIndex + 1
                v5LogFor(xmlEvent,
                    `[V5] 🎵 Semitone-neighbor resync M${xmlEvent.measure} B${xmlEvent.beat} → ${anchorTime.toFixed(3)}s | ` +
                    `matched MIDI pitch(es)=[${chord.notes.map(n => n.pitch).join(',')}] ` +
                    `(expected=[${xmlEvent.pitches.join(',')}], ±1 semitone expansion applied — likely wrong accidental played)`
                )
                return {
                    ...state,
                    anchors: newAnchorsST,
                    beatAnchors: newBeatAnchorsST,
                    ghostAnchor: null,
                    aqntl: state.aqntl, // Don't update AQNTL from a misplay match
                    midiCursor: chord.lastIndex + 1,
                    straySkipCursor: undefined,
                    currentEventIndex: nextIndexST,
                    lastAnchorTime: anchorTime,
                    lastAnchorGlobalBeat: xmlEvent.globalBeat,
                    afterFermata: xmlEvent.hasFermata || false,
                    consecutiveMisses: 0,
                    recentOutcomes: pushOutcome(state.recentOutcomes, 'match'),
                    status: nextIndexST >= xmlEvents.length ? 'done' : 'running',
                }
            }
            v5LogFor(xmlEvent, `[V5 SEMITONE-FALLBACK] No match even with ±1 semitone expansion -> proceeding to dead-reckon`)
        }

        // No match anywhere — this beat has no new onset (held note, rest, ornament)
        // Dead-reckon it as fallback
        const nextIndex = state.currentEventIndex + 1
        if (nextIndex < xmlEvents.length) {
            const nextEvent = xmlEvents[nextIndex]
            const nextBeatsElapsed = nextEvent.globalBeat - xmlEvent.globalBeat

            // Only dead-reckon if the gap is small (≤ 2 beats) — otherwise pause for user
            if (nextBeatsElapsed <= 2) {
                v5LogFor(xmlEvent, `[V5] ⏩ Dead-reckon M${xmlEvent.measure} B${xmlEvent.beat} → ${deadReckonTime.toFixed(3)}s (no onset anywhere) [misses=${state.consecutiveMisses + 1}]`)

                const outcomes = pushOutcome(state.recentOutcomes, 'dead-reckon')
                const badCountDR = outcomes.filter(o => o !== 'match').length
                v5LogFor(xmlEvent, `[V5 DEAD-RECKON] outcomes=${outcomes.join(',')} bad=${badCountDR}/${outcomes.length} accuracy=${Math.round((1 - badCountDR / Math.max(1, outcomes.length)) * 100)}%`)
                if (isRunaway(outcomes)) {
                    // Accuracy dropped below 80% over last 20 events — stop cleanly.
                    // Do NOT add more anchors from this point; everything up to here is reliable.
                    v5Log(`[V5] 🛑 Stopping at M${xmlEvent.measure} B${xmlEvent.beat}: accuracy ${Math.round((1 - badCountDR / outcomes.length) * 100)}% over last ${outcomes.length} events (threshold 80%). Mapped ${state.anchors.length} measure anchors reliably.`)
                    return {
                        ...state,
                        recentOutcomes: outcomes,
                        ghostAnchor: null,
                        consecutiveMisses: 0,
                        straySkipCursor: undefined,
                        status: 'done', // Stop — anchors so far are reliable, don't cascade bad data
                    }
                }

                const newAnchors = [...state.anchors]
                const newBeatAnchors = [...state.beatAnchors]
                const isNewMeasure = state.anchors.length === 0 || state.anchors[state.anchors.length - 1].measure !== xmlEvent.measure
                if (isNewMeasure) newAnchors.push({ measure: xmlEvent.measure, time: deadReckonTime })
                if (xmlEvent.beat > 1.01) newBeatAnchors.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: deadReckonTime })

                return {
                    ...state,
                    anchors: newAnchors,
                    beatAnchors: newBeatAnchors,
                    ghostAnchor: null,
                    recentOutcomes: outcomes,
                    consecutiveMisses: state.consecutiveMisses + 1,
                    straySkipCursor: undefined, // Reset: normal dead-reckon advances event
                    currentEventIndex: nextIndex,
                    lastAnchorTime: deadReckonTime,
                    lastAnchorGlobalBeat: xmlEvent.globalBeat,
                    status: nextIndex >= xmlEvents.length ? 'done' : 'running',
                }
            }
        }

        // Large gap or end of piece — non-blocking fallback to preserve playback continuity.
        v5LogFor(xmlEvent, `[V5] ⚠ No match for M${xmlEvent.measure} B${xmlEvent.beat} (expected [${xmlEvent.pitches}]). Auto-continuing at ${deadReckonTime.toFixed(3)}s`)

        const fallbackNextIndex = state.currentEventIndex + 1
        const newAnchors = [...state.anchors]
        const newBeatAnchors = [...state.beatAnchors]
        const isNewMeasure = state.anchors.length === 0 || state.anchors[state.anchors.length - 1].measure !== xmlEvent.measure
        if (isNewMeasure) newAnchors.push({ measure: xmlEvent.measure, time: deadReckonTime })
        if (xmlEvent.beat > 1.01) newBeatAnchors.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: deadReckonTime })

        return {
            ...state,
            anchors: newAnchors,
            beatAnchors: newBeatAnchors,
            ghostAnchor: null,
            recentOutcomes: pushOutcome(state.recentOutcomes, 'dead-reckon'),
            consecutiveMisses: state.consecutiveMisses + 1,
            straySkipCursor: undefined, // Reset: large-gap fallback advances event
            currentEventIndex: fallbackNextIndex,
            lastAnchorTime: deadReckonTime,
            lastAnchorGlobalBeat: xmlEvent.globalBeat,
            status: fallbackNextIndex >= xmlEvents.length ? 'done' : 'running',
        }
    }
}


/**
 * Human confirmed/adjusted the ghost anchor. Lock it in and resume.
 */
export function confirmGhost(
    state: V5MapperState,
    confirmedTime: number
): V5MapperState {
    if (state.status !== 'paused' || !state.ghostAnchor) {
        return state
    }

    const ghost = state.ghostAnchor
    const newAnchors = [...state.anchors]
    const newBeatAnchors = [...state.beatAnchors]

    // Record as real anchor
    const isNewMeasure = newAnchors.length === 0 || newAnchors[newAnchors.length - 1].measure !== ghost.measure
    if (isNewMeasure) {
        newAnchors.push({ measure: ghost.measure, time: confirmedTime })
    }
    if (ghost.beat > 1.01) {
        newBeatAnchors.push({ measure: ghost.measure, beat: ghost.beat, time: confirmedTime })
    }

    // Find corresponding xmlEvent to get globalBeat
    // The ghost corresponds to state.currentEventIndex (it paused before advancing)
    const xmlEventGlobalBeat = state.lastAnchorGlobalBeat // We'll use the ghost's expected position
    // Actually, we need the actual XMLEvent's globalBeat
    // Since we're confirming the ghost, the event at currentEventIndex IS the one that failed
    // We don't have xmlEvents here, but we can compute beatsElapsed from the ghost timing

    // Update AQNTL based on confirmed position
    const actualDelta = confirmedTime - state.lastAnchorTime
    if (actualDelta > 0) {
        // Estimate beatsElapsed from the expected delta vs aqntl
        const estimatedBeats = (state.lastAnchorTime > 0)
            ? Math.max(0.25, actualDelta / state.aqntl)
            : 1
        const instantAqntl = actualDelta / estimatedBeats
        const newAqntl = (state.aqntl * 0.7) + (instantAqntl * 0.3)

        const nextIndex = state.currentEventIndex + 1

        debug.log(`[V5] Ghost confirmed at ${confirmedTime.toFixed(3)}s (M${ghost.measure} B${ghost.beat}). AQNTL updated to ${newAqntl.toFixed(3)}s`)

        return {
            ...state,
            anchors: newAnchors,
            beatAnchors: newBeatAnchors,
            ghostAnchor: null,
            aqntl: newAqntl,
            lastAnchorTime: confirmedTime,
            // We still don't advance midiCursor — human-placed anchor, MIDI position stays
            currentEventIndex: nextIndex,
            status: 'running',
        }
    }

    // Edge case: confirmedTime <= lastAnchorTime, just advance without AQNTL update
    return {
        ...state,
        anchors: newAnchors,
        beatAnchors: newBeatAnchors,
        ghostAnchor: null,
        lastAnchorTime: confirmedTime,
        currentEventIndex: state.currentEventIndex + 1,
        status: 'running',
    }
}


/**
 * Auto-run all remaining steps until paused or done.
 * Use this for confident sections where the human doesn't expect mismatches.
 */
export function runV5ToEnd(
    state: V5MapperState,
    midiNotes: NoteEvent[],
    xmlEvents: XMLEvent[]
): V5MapperState {
    let current: V5MapperState = { ...state, status: 'running' }

    while (current.status === 'running' && current.currentEventIndex < xmlEvents.length) {
        const next = stepV5(current, midiNotes, xmlEvents)
        if (next.status === 'paused') {
            // Auto-confirm ghost at expected position (dead reckoning)
            console.warn(`[V5 RunToEnd] Auto-confirming ghost at M${next.ghostAnchor?.measure} B${next.ghostAnchor?.beat}`)
            const confirmed = confirmGhost(next, next.ghostAnchor!.time)
            current = { ...confirmed, status: confirmed.status === 'running' ? 'running' : confirmed.status }
        } else {
            current = next
        }
    }

    debug.log(`[V5] Complete. ${current.anchors.length} Measure Anchors, ${current.beatAnchors.length} Beat Anchors.`)
    return { ...current, status: 'done' }
}


// ─── Repeat Resolution Pre-Processor ──────────────────────────────────────

/**
 * Estimate roughly how far into the MIDI note array we are after walking
 * through the first `throughIndex` XMLEvents. Uses pure pitch matching
 * (no timing) — fast and sufficient for lookahead scoring.
 */
function roughEstimateMidiPosition(
    xmlEvents: XMLEvent[],
    midiNotes: NoteEvent[],
    throughIndex: number
): number {
    let midiIdx = 0
    for (let ei = 0; ei <= throughIndex && ei < xmlEvents.length; ei++) {
        const event = xmlEvents[ei]
        if (event.pitches.length === 0) continue
        // Scan forward in MIDI (up to 60 notes) for any pitch in this event
        const searchLimit = Math.min(midiIdx + 60, midiNotes.length)
        for (let mi = midiIdx; mi < searchLimit; mi++) {
            if (event.pitches.includes(midiNotes[mi].pitch)) {
                midiIdx = mi + 1
                break
            }
        }
    }
    return midiIdx
}

/**
 * Score how well a set of candidate XMLEvents matches the given MIDI lookahead.
 * Returns count of candidateEvents (up to maxEvents) that have ANY pitch
 * present anywhere in the lookahead notes.
 */
function scoreHypothesis(
    candidateEvents: XMLEvent[],
    lookaheadNotes: NoteEvent[],
    maxEvents: number = 10
): number {
    if (candidateEvents.length === 0 || lookaheadNotes.length === 0) return 0
    const lookaheadPitches = new Set(lookaheadNotes.map(n => n.pitch))
    let score = 0
    const limit = Math.min(candidateEvents.length, maxEvents)
    for (let i = 0; i < limit; i++) {
        if (candidateEvents[i].pitches.some(p => lookaheadPitches.has(p))) {
            score++
        }
    }
    return score
}

/**
 * Macro-Beat Decimator for Polyrhythms & Dense Passages
 *
 * Call this AFTER resolveRepeats() and BEFORE initV5().
 *
 * If a measure contains an excessive number of sub-beat events with tiny
 * inter-event gaps (e.g., 4:3 or 3:2 polyrhythms, cadenzas), the causal
 * V5 window tracker will thrash — it tries to search for 1–2 pitches in a
 * stream of 28+ densely-packed notes, overflows consecutiveMisses, and drifts.
 *
 * Solution: for dense measures we intentionally keep only the structural
 * "Macro Beats" (beat 1.0, 2.0, 3.0 …) and discard everything in between.
 * V5 then sees exactly 2 events for Fantaisie Impromptu M5 instead of 13,
 * beatsElapsed jumps to 1.0 per step, the search window widens to ~1-2 s,
 * and the mapper naturally absorbs performer rubato.
 *
 * The ScrollView already interpolates linearly between beat anchors, so the
 * visual cursor sweeps smoothly through dense measures without jarring snaps.
 *
 * Thresholds (tunable): events > 10 AND minGap ≤ 0.08 beats.
 *   - Normal 4/4 16th notes:   gap = 0.25  → NOT dense (passes through)
 *   - Fantaisie 4:3 polyrhythm: gap ≈ 0.041 → DENSE (decimated to macro beats)
 *   - 32nd notes in 4/4:        gap = 0.125  → NOT dense (passes through)
 *
 * Pure function — does not mutate inputs.
 */
export function simplifyDenseMeasures(xmlEvents: XMLEvent[]): XMLEvent[] {
    const result: XMLEvent[] = []
    const byMeasure = new Map<number, XMLEvent[]>()

    for (const e of xmlEvents) {
        if (!byMeasure.has(e.measure)) byMeasure.set(e.measure, [])
        byMeasure.get(e.measure)!.push(e)
    }

    for (const [, events] of byMeasure.entries()) {
        // Calculate smallest inter-event beat gap
        let minGap = Infinity
        for (let i = 1; i < events.length; i++) {
            const gap = events[i].beat - events[i - 1].beat
            if (gap > 0 && gap < minGap) minGap = gap
        }

        // Dense detection: too many events AND micro-gaps indicating cross-rhythm
        const isDense = events.length > 10 && minGap <= 0.08

        if (isDense) {
            // Keep only integer beat boundaries: beat 1.0, 2.0, 3.0 …
            // Epsilon of 0.001 guards against floating-point beat values like 0.999
            const macroEvents = events.filter(e => Math.abs(e.beat % 1) < 0.001)

            if (macroEvents.length > 0) {
                result.push(...macroEvents)
            } else {
                // Paranoia fallback: at minimum keep the measure downbeat
                result.push(events[0])
            }

            debug.log(
                `[simplifyDenseMeasures] M${events[0].measure}: DENSE ` +
                `(${events.length} events, minGap=${minGap.toFixed(4)}) → ` +
                `kept ${macroEvents.length > 0 ? macroEvents.length : 1} macro beat(s)`
            )
        } else {
            result.push(...events)
        }
    }

    return result
}

/**
 * Repeat-aware XMLEvent pre-processor.
 *
 * Call this BEFORE initV5(). It detects repeat sections (marked with
 * repeatStart / repeatEnd flags on XMLEvents) and uses 25-note MIDI
 * pitch lookahead to determine whether the recording follows each repeat.
 *
 * If the repeat IS followed → the section's XMLEvents are duplicated (with
 * adjusted globalBeat values) so the mapper sees the correct event sequence.
 *
 * If the repeat is NOT followed → returns events unchanged.
 *
 * Pure function — does not mutate inputs.
 */
export function resolveRepeats(
    xmlEvents: XMLEvent[],
    midiNotes: NoteEvent[]
): XMLEvent[] {
    // ── Step 1: Find all repeat sections ──────────────────────────
    const sections: { startIdx: number; endIdx: number }[] = []
    let sectionStartIdx = -1

    for (let i = 0; i < xmlEvents.length; i++) {
        const e = xmlEvents[i]
        if (e.repeatStart && e.beat <= 1.01) {
            sectionStartIdx = i
        }
        if (e.repeatEnd && sectionStartIdx >= 0) {
            // Extend to the last event in the repeat-end measure
            const repeatEndMeasure = e.measure
            let endIdx = i
            while (endIdx + 1 < xmlEvents.length && xmlEvents[endIdx + 1].measure === repeatEndMeasure) {
                endIdx++
            }
            sections.push({ startIdx: sectionStartIdx, endIdx })
            sectionStartIdx = -1
        }
    }

    if (sections.length === 0) {
        debug.log('[resolveRepeats] No repeat sections found — returning events unchanged.')
        return xmlEvents
    }

    debug.log(`[resolveRepeats] Found ${sections.length} repeat section(s).`)

    // ── Step 2: Process sections left-to-right ────────────────────
    let result = [...xmlEvents]
    let insertionOffset = 0

    for (const section of sections) {
        const adjStart = section.startIdx + insertionOffset
        const adjEnd   = section.endIdx + insertionOffset

        if (adjEnd >= result.length) break

        // Estimate MIDI cursor position when we reach the end of this section
        const midiCursorAtEnd = roughEstimateMidiPosition(result, midiNotes, adjEnd)
        const lookaheadNotes  = midiNotes.slice(midiCursorAtEnd, midiCursorAtEnd + 25)

        // Hypothesis A: no repeat — events after section match lookahead?
        const afterEvents = result.slice(adjEnd + 1, adjEnd + 11)
        const scoreA = scoreHypothesis(afterEvents, lookaheadNotes)

        // Hypothesis B: repeat taken — section-start events match lookahead?
        const startEvents = result.slice(adjStart, adjStart + 10)
        const scoreB = scoreHypothesis(startEvents, lookaheadNotes)

        const startMeasure = result[adjStart]?.measure ?? '?'
        const endMeasure   = result[adjEnd]?.measure ?? '?'
        debug.log(
            `[resolveRepeats] M${startMeasure}-M${endMeasure}: ` +
            `scoreA(noRepeat)=${scoreA} scoreB(repeat)=${scoreB} ` +
            `midiCursor=${midiCursorAtEnd} lookahead=${lookaheadNotes.length} notes`
        )

        // Conservative: only expand if repeat hypothesis wins clearly
        if (scoreB <= scoreA) {
            debug.log('[resolveRepeats] → Skipping repeat (no-repeat wins or tie).')
            continue
        }

        // ── Expand: duplicate the section and insert after adjEnd ────
        const sectionEvents = result.slice(adjStart, adjEnd + 1)

        // Beat span of the section (from first event to one note-duration past last event)
        const firstGlobalBeat = result[adjStart].globalBeat
        const lastGlobalBeat  = result[adjEnd].globalBeat
        const sectionBeatSpan = (lastGlobalBeat - firstGlobalBeat) + (result[adjEnd].smallestDuration ?? 1)

        // Duplicate with shifted globalBeat, strip repeat flags to avoid recursion
        const duplicated: XMLEvent[] = sectionEvents.map(e => ({
            ...e,
            globalBeat: e.globalBeat + sectionBeatSpan,
            repeatStart: false,
            repeatEnd: false,
        }))

        // Insert immediately after adjEnd
        result = [
            ...result.slice(0, adjEnd + 1),
            ...duplicated,
            ...result.slice(adjEnd + 1),
        ]

        // Shift globalBeat of ALL events after the inserted block
        // (they were originally calculated without this repeat, so they're off by sectionBeatSpan)
        for (let i = adjEnd + 1 + duplicated.length; i < result.length; i++) {
            result[i] = { ...result[i], globalBeat: result[i].globalBeat + sectionBeatSpan }
        }

        insertionOffset += duplicated.length
        debug.log(
            `[resolveRepeats] ✓ Repeat taken M${startMeasure}-M${endMeasure}: ` +
            `duplicated ${duplicated.length} events. Total: ${result.length}`
        )
    }

    return result
}
