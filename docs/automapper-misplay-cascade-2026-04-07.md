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

---

## Follow-up Regression: M8 B3.25 False Positive via Octave Fallback (Same Session)

**Commit:** `83ac7f8`

### Symptom
After fixing the semitone fallback's window, M8 B3.25 started anchoring at **17.20s** instead of the expected ~16.75s. The sidebar showed:
```
B3:    16.62  ✅
B3.25: 17.20  ❌ (expected ~16.75)
B3.5:  17.34
B3.75: 17.31  ← ordering violation: 17.31 < 17.34
```

### Root Cause: Performer Rush + Octave Fallback Wide Window

**M8 B3.25 expected pitch:** B#3=60 (from Voice 1 RH running passage: D#4/B#3/D#4/G#4...)

**What the performer actually played:**
```
16.326s: G#2=44, G#1=32, C4=60  ← performer played B#3 (=C♮4=60) EARLY,
                                    at the same time as the G# bass chord
16.618s: D#4=63                  ← B3 RH note (mapper anchors B3 here ✅)
```

The performer rushed B#3=60 to 16.326s (attached to the bass chord), instead of at ~16.75s (its proper beat-3.25 position). When B3 was anchored to D#4=63 at 16.618s, the MIDI cursor advanced past D#4's index — and C4=60 at 16.326s was a *lower* index, already behind the cursor.

**Octave fallback then fired:**
- Expected B#3=60 not found (cursor past its position)
- `expandToOctaveEquivalents([60])` → includes **B#4=72 = C5=72**
- C5=72 appeared at 17.196s (M7's arpeggio)
- `findContinuityResyncMatch` with `maxForwardHorizon = aqntl * 1.75 = 0.83 * 1.75 = 1.45s` → searched up to 16.828 + 1.45 = **18.28s**
- C5=72 at 17.196s fell inside the window → wrongly grabbed for M8 B3.25

**This is the same class of bug as M8 B1.5** but now via the octave fallback instead of semitone. Both are caused by `findContinuityResyncMatch` searching too far ahead.

### Key Distinction
- **M8 B1.5 (C# misplay):** Note WAS played at the right time, just wrong pitch → semitone fallback catches it ✅
- **M8 B3.25 (B#3 rushed):** Note WAS played but too early, cursor moved past it → octave fallback must NOT reach into the next beat to grab an octave-equivalent

### Fix: Tighten Octave Fallback to Same Tight Window

Same architectural fix applied to the octave fallback as was applied to semitone:

```
Old: findContinuityResyncMatch(octavePitches, ...) ← searches up to 1.45s ahead
New: scanWindow(octavePitches, sorted, scanStartIndex, searchStart, searchEnd)
     ← same ±20% tight window as normal exact-match scan
```

C5=72 at 17.196s vs tight window `[16.59, 16.87]`:  
`17.196 > 16.87` → outside window → correctly ignored → falls through to dead-reckon ✅

**All three fallbacks now share one unified time constraint:**
| Fallback | Window | Rationale |
|----------|--------|-----------|
| Exact match | `[searchStart, searchEnd]` (±20%) | Normal |
| ±1 Semitone | `[searchStart, searchEnd]` (±20%) | Misplay is at the right time, wrong key |
| Octave equivalent | `[searchStart, searchEnd]` (±20%) | Wrong register is at the right time |
| Dead-reckon | N/A | No note found → interpolate |

If a note is outside the ±20% timing window, it is not a misplay of the expected note — it belongs to a different beat entirely.

---

## UI Fix: Anchor Deletion Cascade (Same Session)

**Commit:** `83ac7f8`  
**Files:** `app/studio2/edit/[id]/page.tsx`, `components/studio2/score/AnchorSidebarStudio2.tsx`

### Problem
Clicking the red trash icon on a measure anchor (e.g. M8) only removed the **measure-level anchor** from `anchors[]`. All associated **beat anchors** (`beatAnchors[]` for M8 B1.25, B1.5, ..., B4.75) were left as orphaned entries. They would continue to affect the visual display even though the parent measure was gone.

### Fix: Cascade Deletion

`handleDeleteAnchor` updated to also filter `beatAnchors`:

```typescript
// Before
const handleDeleteAnchor = useCallback((measure: number) => {
    if (measure === 1) return
    setAnchors(anchors.filter((a) => a.measure !== measure))
}, [anchors, setAnchors])

// After
const handleDeleteAnchor = useCallback((measure: number) => {
    if (measure === 1) return
    setAnchors(anchors.filter((a) => a.measure !== measure))
    setBeatAnchors((prev) => prev.filter((b) => b.measure !== measure)) // ← cascade
}, [anchors, setAnchors, setBeatAnchors])
```

### New: Individual Beat Anchor Deletion

Added `onDeleteBeatAnchor` prop to `AnchorSidebar`. Each yellow sub-beat row now renders a small `<Trash2>` icon button that removes only that specific beat anchor (`measure + beat` pair), leaving the measure anchor and siblings intact.

**Use cases:**
- **Red measure 🗑:** Delete the measure anchor and ALL its beat anchors (cascade)
- **Yellow beat 🗑:** Delete only that one misaligned sub-beat without touching the measure or neighbors
