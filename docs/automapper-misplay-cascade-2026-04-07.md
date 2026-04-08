# Bug: AutoMapperV5 Cascading Misalignment from Wrong Accidental

**Date:** 2026-04-07  
**File:** `lib/engine/AutoMapperV5.ts`  
**Piece used to reproduce:** Rachmaninoff Prelude Op.3 No.2 (Epic Prelude variant), `rach prelude final midi 120 bpm small part.mid` vs `Epic Prelude Lionel v16-smallpart.musicxml`

---

## Symptom

Everything mapped correctly through M8 B1.75. At M8 B2, the anchor timestamp jumped to **17.20s** instead of the correct **~15.82s** — a 1.38s error. All subsequent anchors (B2.25, B2.5, ...) were offset by this drift, making the waterfall display completely wrong for the rest of the piece from that point.

From the anchor sidebar:
```
M8:   15.23  ✅
B1.25: 15.36  ✅
B1.5:  15.82  ✅ (correct visually, but see root cause below)
B1.75: 16.09  ✅
B2:   17.20  ❌  (should be ~15.82s)
```

---

## Root Cause

The MIDI is a **live performance recording** (not quantized). At M8 B1.5, the score expects **C♮3 (MIDI pitch 48)** in the left hand arpeggio. The performer played **C#3 (MIDI pitch 49)** — a 1-semitone wrong accidental.

The exact cascade:

### Step 1 — Exact match fails
`C#3 = 49 ≠ 48 (C♮3)` → no match in window.

### Step 2 — Octave fallback incorrectly steals from B2's chord
`expandToOctaveEquivalents([48])` expands C♮3 to all C-class notes in piano range:
```
[C1=24, C2=36, C3=48, C4=60, C5=72, C6=84, C7=96]
```
**C5 = MIDI 72 = enharmonically B#4.**  
The M8 B2 chord (written as F#4 / B#4 / D♮5) contains **B#4 = MIDI 72**.  
The octave fallback found B#4=72 at 15.82s (which is actually M8 B2's timestamp) and **wrongly anchored M8 B1.5 there**.  
The MIDI cursor then advanced past B#4, **consuming it from the B2 chord**.

### Step 3 — B1.75 misses E3
With `lastAnchorTime = 15.82s`, the window for B1.75 (expects E3=52) started at ~15.82s.  
But E3 was played at 15.67s — **before the window** → dead-reckoned to ~16.09s.

### Step 4 — B2 finds a substitute B#4 far ahead
With B#4=72 already consumed from the B2 chord, the mapper searched for the next occurrence of B#4=72 in the MIDI stream. The next one appeared at **17.20s** in a completely different musical context → B2 anchored there.

All subsequent anchors (B2.25 through M9+) were offset by ~1.38s.

---

## What Was NOT the Problem

- It was NOT a measure offset (MIDI has no measure concept — it's a live recording)
- It was NOT a tempo mismatch (MIDI is constant 120 BPM)
- It was NOT the semitone misplay itself directly causing drift — it was the octave fallback's **enharmonic note-stealing** that caused it

---

## Failed / Intermediate Approaches

### Attempt 1 — Add ±1 semitone fallback (after octave)
Added `expandToSemitoneNeighbors()` as a last-resort fallback **after** the octave fallback.  
**Problem:** The octave fallback still ran first and returned early, stealing B#4 before the semitone fallback could fire. The semitone fix was never reached.

### Attempt 2 — Change rolling window from 10→20, threshold 70%→80%
Changed `isRunaway()` to stop mapping if accuracy drops below 80% over 20 events.  
**Problem:** This improved the "stop clean" behavior but did not fix the root cause — the cascade already happened before accumulating 5 bad events in 20.

---

## Final Fix (Commit: `1059042`)

**Swapped the fallback priority order** — semitone now runs **before** octave:

```
Old order:
  1. Exact match
  2. Octave equivalent  ← stole B#4 from next beat
  3. ±1 Semitone        ← never reached
  4. Dead-reckon

New order:
  1. Exact match
  2. ±1 Semitone        ← C#3=49 found at 15.52s, anchored correctly ✅
  3. Octave equivalent  ← now only fires if semitone also fails
  4. Dead-reckon
```

**Why this works:**  
A ±1 semitone error (C# instead of C♮) is a **wrong-finger misplay** — the note lands at exactly the right time, just one key off. The octave fallback is intended for cases where the performer played in the wrong register. Semitone misplays are far more common (especially in chromatic passages) and always occur at the correct timestamp, making them the higher-priority recovery path.

With semitone firing first:
- C#3=49 is within ±1 of C♮3=48 → matched at 15.52s ✅
- midiCursor advances past C#3 (consumed)
- B2's chord (F#4/B#4/D♮5) remains fully intact
- B2 scanned and matched at 15.82s ✅
- Full cascade eliminated

---

## Additional Changes Made in This Session

### ±1 Semitone fallback function
```typescript
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
```

### Cleaner stop-on-low-accuracy behavior
`isRunaway()` now uses a 20-event rolling window with an 80% accuracy threshold (≥5 non-matches = stop). When triggered, the mapper returns `status: 'done'` immediately — preserving all reliable anchors accumulated so far and not adding any dead-reckoned anchors after the confusion point.

---

## Key Insight for Future Debugging

When the octave fallback is active, check for **enharmonic equivalents of the expected pitch** in the surrounding MIDI chord clusters. B#4=C5, E#4=F4, Cb5=B4, Fb4=E4 are common sources of false positives in chromatic passages because they appear naturally in neighboring harmonies.

The time window for `findContinuityResyncMatch` is wide enough (~0.45s upper slack) to reach into the next beat's material, which is why the false positive was not caught by timing alone.

---

## Follow-up Regression: M6 B4.75 False Positive (Same Session)

**Commit:** `1f5a278`

### Symptom
After the M8 fix (semitone before octave), M6 B4.75 suddenly appeared at 13.37s instead of ~12.78s. Gap from B4.5 (12.65s) to B4.75 (13.37s) = 0.72s for 0.25 beats — impossibly slow.

### Root Cause
The semitone fallback was using `findContinuityResyncMatch` which searches up to ~1 beat ahead of expected time. M6 B4.75 expects D#3=51. The performer **skipped** this note and jumped to M7 content. Semitone expansion of D#3=51 = `[D3=50, D#3=51, E3=52]`. E3=52 appeared at 13.37s (M7's arpeggio). Since the continuity-resync window reached to 13.77s, E3 was grabbed and M6 B4.75 was wrongly anchored at 13.37s.

### Key distinction from M8 bug
- **M8:** The note WAS played (C#3 instead of C♮3) at the RIGHT TIME → broad search needed to catch it  
- **M6:** The note was NOT played; a different note appeared 0.72s later from a different beat → broad search was wrong to grab it

### Fix
Semitone fallback now uses `scanWindow` with the **same tight `[searchStart, searchEnd]` window** (±20% of expected delta) as the normal scan. A misplay by definition occurs at the correct beat time. If the ±1 semitone note is outside the normal window, it belongs to a different beat, not a misplay.

- M8 C#3=49 at 15.52s, window `[15.28, 15.62]` → inside → ✅ correctly caught  
- M6 E3=52 at 13.37s, window `[12.64, 12.82]` → outside → ✅ correctly ignored
