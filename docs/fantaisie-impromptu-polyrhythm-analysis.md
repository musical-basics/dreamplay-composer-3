# Fantaisie Impromptu Polyrhythm — AutoMapperV5 Deep-Dive Analysis

_Documented: 2026-04-07_

## Background

M1–M4 mapping was fixed by:
1. **Post-tie fresh scan** — when the opening tied G# pedal tones (M1+M2 `isTiedContinuation`) are dead-reckoned through, the next real event (M3) now bypasses the AQNTL window and does an unconstrained forward pitch scan
2. **AQNTL calibration at M3** — once M3 notes are found at ~4.96s, AQNTL is recalibrated from `(4.96 - 0.34) / 4 globalBeats ≈ 1.155s/beat`

**Problem:** Starting at M5, the 4:3 polyrhythm begins and the mapper breaks again.

---

## 1. Musical Reality: What M5 Actually Contains

The piece is in **2/2 (cut time)** — 2 half-note beats per measure.  
`divisions = 256` per quarter note → **512 divisions per half-note, 1024 per measure**.

### M5 — Two Completely Separate Rhythmic Streams

**Right Hand (Voice 1, Staff 1):** 16 regular 16th notes
- Each note = 64 divisions = 1/16 of a whole note = **1/4 quarter note**
- Starts with a 16th-rest, then: G#4, A4, G#4, F##4, G#4, C#5, E5, D#5, C#5, D#5, C#5, B#4, C#5, E5, G#5
- Beat-slot formula: `beatVal = 1 + (timestamp.RealValue × denominator)`
  With denominator=2: slot 1 = beat 1.000, slot 2 = beat 1.125 ... up to beat 1.9375

**Left Hand (Voice 3, Staff 2):** 12 sextuplet eighth notes (two groups of 6)
- Tuplet ratio: `actual-notes=6, normal-notes=4, normal-type=eighth`
- Meaning: **6 notes in the time of 4 eighth notes = 6 notes in 2 quarter notes**
- Each note ≈ 85–86 divisions (1024 / 12 ≈ 85.33)
- Pitches: C#3, G#3, C#4, E4, C#4, G#3 | E3, G#3, C#4, E4, C#4, G#3
- Beat slots: 1.000, ~1.167, ~1.333, 1.500, ~1.667, ~1.833

---

## 2. The Core Problem: 4-Against-6 Cross-Rhythm (4:3 per half-note)

In one measure of 2/2 time, **simultaneously**:
- RH plays **16 evenly spaced notes** (spacing = 1/16 of whole = 0.0625 beats)
- LH plays **12 evenly spaced notes** (spacing = 1/12 of whole ≈ 0.0833 beats)

This is a **4:3 polyrhythm per half-note beat**, or **16:12 = 4:3** over the full measure.  
LCM(16, 12) = 48 → the two grids share a common point only every 1/48 of a whole note.

### Coincidence Points in M5

| Time position (of whole note) | RH note? | LH note? |
|---|---|---|
| 0/48 = 0.000 | G#4 (1 rest before) | C#3 |
| 4/48 = 0.083 | A4 | — |
| 4/48 = 0.083 | — | G#3 |
| 8/48 = 0.167 | G#4 | — |
| 8/48 = 0.167 | — | C#4 |
| 12/48 = 0.250 | F##4 | E4 *(near collision)* |
| 16/48 = 0.333 | G#4 | — |
| 16/48 = 0.333 | — | C#4 |
| 24/48 = 0.500 | C#5 E5 | G#3 *(beat 2 downbeat)* |
| ... | ... | ... |

Only 4 out of 48 grid slots have both voices coinciding (exact or near).

---

## 3. Failure Mode A: Beat-Slot Collision in the XMLEvent Extractor

### What happens in `ScrollView.tsx`

The code groups all note-heads at the **same `beatVal`** (same OSMD timestamp) into a single `XMLEvent`.

With denominator=2 in the beat formula, M5 generates:
- **Voice 1 (RH):** 16 unique beat slots spaced at 0.125
- **Voice 3 (LH):** 12 unique beat slots spaced at ~0.167

**Total: 13 unique beat slots** in the measure (beats 1.000 and 1.500 are shared; all others are unique to one hand).

**At the shared positions (1.000 and 1.500):** Both RH and LH notes get merged into the *same XMLEvent* with their pitches combined. The mapper must find ALL of those pitches simultaneously in the MIDI — but the pianist plays them at fractionally different times.

**At non-shared positions:** The XMLEvent has pitches from only ONE hand (1–2 notes). The mapper searches for those specific pitches...

### The Cascade

The mapper's `scanWindow` finds MIDI notes in `[searchStart, searchEnd]`. When it searches for **beatVal=1.125** (pure RH moment with note G#4), the scan window overlaps other concurrent notes from the LH that are slightly adjacent. This creates:

1. **False chord ingestion:** `extractChord` grabs adjacent notes within `chordThreshold` time, potentially pulling in the LH note that belongs to a *different* XMLEvent beat
2. **Window exhaustion:** LH notes consumed into an earlier RH cluster can't be found when the LH's own XMLEvent fires
3. **Stray detection false positives:** Single-pitch RH events with partial coverage trigger the `matchRatio < 0.5` stray rejection and dead-reckon instead of confirming

---

## 4. Failure Mode B: Beat Density × AQNTL = Impossibly Small Windows

At performance tempo (~1.155s/quarter-note after M3 calibration):

- **RH 16th note spacing:** 1.155s × 0.25 = **0.289s** per 16th
- **LH sextuplet spacing:** 1.155s × (2/6) = **~0.385s** per LH note

The V5 search window:
```
buffer = expectedDelta × 0.20
searchStart = lastAnchorTime - buffer × 0.5
searchEnd   = lastAnchorTime + expectedDelta + buffer
```

With `expectedDelta ≈ 0.289s` (one 16th gap), `buffer = 0.058s`.  
**Window width: only ~0.35s** — tight enough that performer rubato, pedal smear, or hand latency pushes notes outside.

At this note density with polyrhythmic offsets, `consecutiveMisses` fills up within 3–4 events, triggering the fresh-scan path at almost every beat — destroying both throughput and AQNTL calibration quality.

---

## 5. Failure Mode C: Pitch Uniqueness Crisis

The LH arpeggio pattern in the Fantaisie Impromptu is **highly repetitive** within each measure:

- Group 1: C#3, G#3, C#4, E4, C#4, G#3
- Group 2: E3, G#3, C#4, E4, C#4, G#3

The notes **G#3, C#4, E4** repeat multiple times per measure. When V5 calls `findFirstPitchMatch([56, 49])` (G#3=56, C#4=49), it matches the **first** occurrence in the MIDI stream — which may already be consumed by a prior XMLEvent, or may be from the next cycle (phase-error).

Because `midiCursor` advances linearly and LH notes repeat every ~0.385s, if the cursor overshoot by even one note, pitch matching locks onto the next cycle — introducing a systematic ~0.385s phase error compounding across the measure.

---

## 6. Failure Mode D: AQNTL Miscalibration from Tuplet Irrational Fractions

The globalBeat formula uses `cumulativeBeats += numerator` (2 per 2/2 measure) and `globalBeat = cumulativeBeats + (b - 1)`. For M5's 13 sub-events:

```
M5 globalBeats span: [8.000, 8.833]
(6 LH events: 8.000, 8.167, 8.333, 8.500, 8.667, 8.832)
(RH events: 8.000, 8.125, 8.250, ... up to 8.875)
```

The `beatsElapsed` between successive M5 events is only `0.125–0.167` beats.  
`expectedDelta = 0.125 × 1.155s ≈ 0.144s` — correct, but leaves zero tolerance margin.

Worse: the AQNTL was calibrated from the *measure-boundary* transitions in M3/M4. The intra-measure note spacing involves tuplet irrational fractions (85/1024 of a measure) that don't map cleanly to the globalBeat integer grid. The globalBeat for an LH note at 85/1024 is:

```
b = 1 + (85/1024) × 2 / (1/256) = ... = approximately 1.166
globalBeat = 8 + (1.166 - 1) = 8.166
```

This means `beatsElapsed` from the M5 downbeat to the second LH note = **0.166 beats**, and AQNTL gives `expectedDelta = 0.192s`. The actual note is at ~0.385s from the downbeat. **50% AQNTL error** — the window completely misses.

---

## 7. Summary: The Three Architectural Failures

| Layer | Problem | Consequence |
|---|---|---|
| **XMLEvent Extraction** | Merges RH+LH pitches at 2 shared beat slots; 11 other slots have single-hand thin events (1-2 pitches) | V5 searches for 1–2 pitches in a dense stream of 28 notes/measure; flood of small partial matches |
| **AQNTL Window Logic** | Intra-beat window too narrow at 16th-note density; tuplet fractions introduce ~50% AQNTL error for LH sub-beats | 3–4 consecutive misses per measure → fresh-scan thrashing every beat |
| **Pitch Matching** | Repetitive LH arpeggio (G#3, C#4, E4 cycle every 0.385s) defeats `findFirstPitchMatch`; wrong occurrence matched | Cursor phase error ±0.385s; every subsequent LH beat misaligned |

---

## 8. Candidate Approaches for Deep-Think AI Evaluation

### Option A: Voice-Separated XMLEvent Lists
Parse the MusicXML into **two parallel streams** — one per staff/voice — and run V5 independently on each. Then merge the resulting anchors.
- **Pros:** Eliminates pitch collision entirely; per-hand AQNTL calibration
- **Cons:** MIDI has no voice separation — must infer which MIDI notes belong to which hand (possible via register/pitch-range heuristics: LH < 60, RH ≥ 60 roughly)

### Option B: Measure-Level Anchoring Only for Polyrhythm Measures
Detect polyrhythm measures (where `LCM(RH_note_grid, LH_note_grid) > 32`) and emit **only a measure-boundary XMLEvent** for them. V5 matches just the downbeat, skips intra-measure beat mapping.
- **Pros:** Robust, simple, ~20 lines to implement
- **Cons:** No sub-beat granularity for visualization in polyrhythm sections

### Option C: Common-Grid Quantization (LCM-based)
Compute LCM of the two rhythmic streams (e.g. LCM(16, 12) = 48) and quantize **both** to this common grid. At each of the 48 grid points, emit an XMLEvent with only the voices that actually attack there. The MIDI cursor advances through a 48-slot grid per measure.
- **Pros:** Mathematically exact; handles any polyrhythm
- **Cons:** Requires significant changes to ScrollView extractor + V5 engine; may produce very small pitch sets

### Option D: AQNTL-Adaptive Window Expansion
When `smallestDuration ≤ 1/8` AND MIDI note density exceeds a threshold (>12 notes/measure), switch to **"grain mode"** where scan window expands to ±1 full AQNTL and uses best pitch-coverage match rather than temporal proximity.
- **Pros:** Minimal architectural change; handles any dense passage
- **Cons:** Looser matching may pick wrong occurrence of repeated pitches (Failure Mode C still applies)

### Option E: MIDI Tempo Track as Ground Truth
Instead of inferring AQNTL from XMLEvent globalBeat spacing, extract the **MIDI tempo track** directly from the `.mid` file's `setTempo` meta-events. Use this as an exact AQNTL map keyed by MIDI tick time.
- **Pros:** Eliminates the AQNTL estimation problem entirely; zero error on tempo; already available in the parsed MIDI data (`parsedMidi.tempoChanges`)
- **Cons:** AQNTL from MIDI tempo ≠ performed tempo if performer plays at different BPM from score notation; requires matching `tick` time to globalBeat mapping

### Option F: Selective Measure-Level + Post-Measure Resync (Hybrid)
For polyrhythm measures: anchor only the measure downbeat (like Option B), but after each polyrhythm measure, do a fresh-scan resync to re-anchor at the next measure's downbeat. The intra-measure beats float freely but measures themselves stay pinned.
- **Pros:** Ensures visualization stays synced measure-by-measure even if sub-beats drift
- **Cons:** Visualization within polyrhythm measures will interpolate rather than snap to exact beat positions

---

## 9. Recommended Approach (Hybrid B+F with E as AQNTL source)

1. **Use MIDI `tempoChanges`** (Option E) to derive an accurate per-position AQNTL map — eliminating the 50% estimation error at intra-beat positions
2. **Detect polyrhythm measures** by checking if any beat contains notes from multiple voices with LCM > 16
3. **For polyrhythm measures:** emit only a single XMLEvent at the measure downbeat; anchor the measure boundary tightly
4. **After each polyrhythm measure:** run a mini fresh-scan to confirm the next measure's downbeat was correctly found before continuing

This gives accurate measure-level sync (sufficient for score highlighting) while avoiding the impossible sub-beat matching problem in dense polyrhythmic texture.

---

## 10. Deep-Think Prompt Template

**System context:**
You are analyzing a TypeScript MIDI-to-MusicXML score alignment system (`AutoMapperV5`). The system extracts `XMLEvent` objects from OSMD (Open Sheet Music Display) — each event has `{measure, beat, globalBeat, pitches[], isTiedContinuation}` — and matches them to MIDI note onsets using an AQNTL-calibrated search window. This works well for homophonic music but breaks on polyrhythmic passages.

**Specific failure case:**
- Chopin Fantaisie Impromptu Op. 66, 2/2 cut time
- M5+: 16 RH 16th notes simultaneous with 12 LH sextuplet eighth notes per measure (4:3 cross-rhythm)
- The system produces XMLEvents at 13 different sub-beat positions in the measure, many with only 1–2 pitches
- The MIDI stream has 28 notes/measure packed densely; many pitches repeat (G#3, C#4, E4 in the LH cycle every ~0.385s)

**Question:**
Among Options A–F described above, which provides the best balance of:
1. Robustness to polyrhythmic complexity
2. Correctness of measure-boundary anchor placement for visualization sync
3. No regression on simpler time signatures (4/4, 3/8, 6/8)
4. Implementation complexity (budget: ~200 lines of TypeScript changes)

Please also evaluate whether standard score-following algorithms (DTW dynamic time warping, HMM hidden Markov models, online score following) would handle this polyrhythm case inherently, and whether any can be adapted to this TypeScript browser-side context.
