# Studio2 Playback Stuck at M10 — Full Investigation (2026-04-05)

## Summary

Playback cursor gets stuck around measure 9-10 on `/studio2` for a specific piece ("Sunflowers" — 160 measures, ~59 second audio, piano). The audio keeps playing but the cursor freezes. Additionally, click-to-seek on the score does nothing. Two separate but related bugs were discovered during investigation.

---

## Bug 1: V5 AutoMapper produces wrong anchor time for M10

### Symptom
The V5 mapper consistently places M10 at `t=20.323s` instead of the expected `~17.4s`. This creates a 4.86-second gap between M9 (15.461s) and M10 (20.323s), while the average measure duration is ~1.95s. The cursor crawls through M9 for ~4 seconds while the audio plays M10+ content.

### Data
```
Measure anchors (M8-M12): M8 t=13.505 | M9 t=15.461 | M10 t=20.323 | M11 t=22.745 | M12 t=25.163
Beat anchors M8-M12: M8B2 t=14.013 | M8B4 t=14.980 | M9B3 t=16.443 | M10B3.5 t=21.542 | M10B4 t=22.268
```

Missing beat anchors: M9 B2, M9 B4, M10 B1, M10 B2, M10 B3 — the mapper failed to find MIDI matches for these beats.

### V5 mapper behavior
- AQNTL (average quarter note time length) starts at 0.5s (120 BPM default)
- The mapper matches M1-M9 correctly against MIDI note onsets
- At M9 B4, it fails to find a matching MIDI chord in the search window
- It dead-reckons forward, producing increasingly inaccurate times
- By M25-M27, runaway detection fires: `Runaway detected (10/10 bad). Auto-recovering without pause at M27 B4.`
- After the MIDI runs out (~59s), dead-reckoning continues using AQNTL=0.5s, producing anchor times up to 328s for M160

### Root cause (FIXED — 2026-04-05, commit f636713)

**The actual cause** (discovered by inspecting the raw MIDI + MusicXML files):

XML M9 (mapper M10) beat 1 contains G1/G2 notes from the LEFT HAND that are
**tie-continuations** from M9 beat 3 (where those notes begin at t=16.436). Tied notes
appear as real `<note>` elements in MusicXML, but produce **no new MIDI note-on events**
at that position — the note was already sounding since M9 B3.

**The false-match chain:**
1. OSMD includes the tie-stop G1/G2 notes in the `xmlEventsList` as if they're real new onsets
2. Mapper searches for pitches `[31, 43]` at M10 B1 (~t=17.4s)
3. No MIDI note-on exists there (of course — the note started at t=16.436)
4. Window scan and wide scan both fail
5. Fresh scan (`findContinuityResyncMatch`) expands window to t=20.356s
6. Pitch=43 (G2) coincidentally appears at t=20.324s in a completely different passage
7. **False match → M10 anchored at t=20.32 instead of ~t=17.8s**

**The gap:** MIDI has no note-ons between t=16.442 and t=18.645. The actual first new
onset of M10 content is G3 at t=18.645 (right-hand beat 3.5 of M10, after 2.5 beats of rest).

### Fix
In `calculateNoteMap` (`ScrollViewStudio2.tsx`), added a tie-continuation check before
adding pitches to `beatAccumulator` for `xmlEventsList`:
```typescript
const noteTie = n.sourceNote.NoteTie;
if (noteTie) {
    const tieNotes = noteTie.Notes;
    const isTieContinuation = Array.isArray(tieNotes)
        ? tieNotes.length > 0 && tieNotes[0] !== n.sourceNote
        : noteTie.StartNote && noteTie.StartNote !== n.sourceNote;
    if (isTieContinuation) return;
}
```
Tie-stop notes are now excluded from `xmlEventsList`. M10 B1 will have no pitches
(or be absent entirely), so the mapper skips it and correctly moves on to find G3
at t=18.645 as the actual first mappable event in M10.

### Earlier (incorrect) fix attempt
A `straySkipCursor` change was also made to `AutoMapperV5.ts` to prevent midiCursor
runaway during stray-rejection loops. That fix is architecturally valid and kept,
but was NOT the root cause of the M10 misanchor.

---

## Full Fix Timeline (How We Found It)

### Attempt 1: midiCursor runaway during stray-note rejection (WRONG hypothesis)

Initial code analysis of `AutoMapperV5.ts` suggested: the stray-note rejection path
permanently advances `midiCursor` even when `currentEventIndex` is NOT advanced (same XML
event being retried). This would push the scan start past valid notes on retry.

**Fix shipped:** Added `straySkipCursor` to `V5MapperState`. Stray rejections advance
`straySkipCursor` instead of `midiCursor`. All scan calls use
`scanStartIndex = max(midiCursor, straySkipCursor ?? 0)`. Valid architectural fix, kept —
but **not** the root cause.

**After re-mapping:** M10 still at t=20.32. No effect.

### Attempt 2: Fresh-scan minTime drift (NOT TESTED)

Theory: dead-reckoning increments `lastAnchorTime`. After several dead-reckons, `lastAnchorTime`
drifts past the real note time (~17.4s). `findContinuityResyncMatch` sets
`minTime = max(lastAnchorTime, ...)`, which floors the fresh scan above the real notes.
`lastRealMatchTime?: number` reserved in state for a future fix.

**Bypassed** — investigation moved to inspecting the raw data directly.

### Root Cause Found: Inspecting the raw MIDI + MusicXML files

Parsed `Sunflowers Final MIDI.mid` and `Sunflowers MusicXML.musicxml` with Node.js scripts.

**MIDI note-ons in the 14–22s window:**
```
t=15.461–15.469  pitches=[67,38,41,45,50]  ← M9 B1, matched correctly
t=16.436         pitch=31  (G1, left hand chord)
t=16.442         pitch=43  (G2, left hand chord)
       ← 2.2-second SILENCE: no MIDI note-ons from t=16.442 to t=18.645 →
t=18.645         pitch=55  (G3, right-hand riff — first real M10 onset)
...
t=20.324         pitch=43  ← the FALSE match
```

**MusicXML measure 9 (mapper M10), Voice 2 (left hand):**
```xml
<note><chord/><pitch><step>G</step><octave>1</octave></pitch>
  <tie type="stop"/>   ← tied from M9 B3 (t=16.436)
```

**The discovery:** MusicXML represents ties across barlines by re-emitting the note element
in the next measure with `<tie type="stop"/>`. The element has real `<step>`, `<octave>`,
and `<duration>` — it looks like a genuine onset to naive code.

In MIDI, a tie is a **single long note-on**. The G1/G2 note-on fired at M9 B3 (t=16.436).
**There is no new note-on at M10 B1.** But `calculateNoteMap` was adding these tie-stop
notes to `beatAccumulator` as if they were real attacks, creating an `xmlEventsList` entry
for M10 B1 with pitches `[31, 43]`.

**False-match chain:**
1. Mapper looks for `[31, 43]` at M10 B1 (~t=17.4s)
2. Window scan: no MIDI notes → miss
3. Wide scan: still misses
4. Fresh scan: `maxTime = 17.4 + 2.94 = 20.35s`
5. Pitch=43 (G2) appears coincidentally at t=20.324s in an unrelated passage
6. **False match → M10 anchored at t=20.32** ✗

**The fix:** In `calculateNoteMap`, skip tie-continuation notes before adding to accumulator:
```typescript
const noteTie = n.sourceNote.NoteTie;
if (noteTie) {
    const isTieContinuation = Array.isArray(noteTie.Notes)
        ? noteTie.Notes.length > 0 && noteTie.Notes[0] !== n.sourceNote
        : noteTie.StartNote && noteTie.StartNote !== n.sourceNote;
    if (isTieContinuation) return;
}
```
M10 B1 now has no pitches. Mapper dead-reckons through it and correctly picks up G3 at
t=18.645 (real first onset). M10 anchors at ~t=18.7s. ✓

**Why it was hard to find:** The bug lives at the boundary between two systems — what
MusicXML calls a "note element" vs what MIDI calls a "note-on event." Every individual
component (mapper, MIDI parser, OSMD renderer) was behaving correctly. The false match
was plausible because pitch 43 is common and the fresh-scan window is intentionally wide
for tempo variation. Six abstraction layers separated cause (XML extraction) from symptom
(cursor freeze at M10).

---

### What was tried
- Filtering anchor points beyond audio duration (helps with dead-reckoned junk past 59s, but M10 at 20.3s is within audio duration)
- Outlier gap detection in `findCurrentPosition` — detects gaps > 2.5x median and advances cursor at median tempo instead. This is a WORKAROUND, not a fix for the mapper itself.
- Extrapolation past last anchor — works for measures beyond the mapped range
- Stopping V5 mapper when past MIDI duration — prevents 328s anchors but doesn't fix the M10 matching failure

### Files involved
- `lib/engine/AutoMapperV5.ts` — the mapper itself, `stepV5()` function
- `components/studio2/score/ScrollViewStudio2.tsx` — `findCurrentPosition()` which uses the anchor data
- `app/studio2/edit/[id]/page.tsx` — calls `handleAutoMap()` which runs the V5 mapper

### Key code: how anchors are used for cursor positioning
In `ScrollViewStudio2.tsx`, `findCurrentPosition(audioTime)`:
1. Merges `anchors` (measure-level) and `beatAnchors` (beat-level) into a sorted `allPoints` array
2. Binary-searches for the current audio time
3. Returns `{ measure, beat, progress }` interpolated between the two surrounding anchor points
4. The cursor X position is calculated from the measure's visual bounds and the progress value

When the gap between two anchor points is abnormally large (like M9→M10 = 4.86s vs median 1.95s), the cursor crawls slowly through the current measure while the audio plays ahead.

---

## Bug 2: Audio element cannot seek (click-to-scroll broken)

### Symptom
Clicking on a measure in the score to seek to that position does nothing. The `handleScoreClick` handler fires correctly, finds the right measure, calls `PlaybackManager.seek(time)`, but `audio.currentTime` resets to 0 after assignment.

### Console evidence
```
[PM.seek] requested=5.854 clamped=5.854 maxTime=134.979977 readyState=4 currentTime=1.913352
[PM.seek] after set: currentTime=0
```

### Root cause (FIXED)
The audio is loaded through `/api/asset?url=...` proxy which:
1. Fetches the entire upstream file
2. Returns it as a single response with `Cache-Control: no-store`
3. Does NOT support range requests

Without range request support, the browser's `<audio>` element cannot seek within the audio data. Setting `currentTime` triggers an internal seek that requires byte-range access. The browser silently resets `currentTime` to 0.

### Fix
Load audio as a blob URL instead of streaming from the proxy:
```js
fetch(proxiedAudioUrl)
  .then(res => res.blob())
  .then(blob => {
    blobUrl = URL.createObjectURL(blob)
    audio.src = blobUrl
  })
```
A `blob:` URL gives the browser full random access to the in-memory audio data.

### Secondary issue
`PlaybackManager.seek()` also clamped to `this._duration` which could be 0 if metadata hadn't loaded yet. Fixed to use `audioElement.duration` directly.

### Files changed
- `components/studio2/layout/SplitScreenLayoutStudio2.tsx` — blob URL loading
- `lib/engine/PlaybackManager.ts` — seek clamping fix

---

## Bug 3: /studio OSMD wrapping (separate from /studio2)

### Symptom
On `/studio`, OSMD renders measures 157-160 at the same visual positions as measures 10-13. The measure labels show: M8, M9, **M157**, M11, M12, **M158**, M14, M15.

### Root cause (FIXED)
The `/studio` OSMD hook (`hooks/useOSMD.ts`) used a single `999999px` container width for rendering. For 160-measure scores, this wasn't wide enough, causing OSMD to wrap later measures back to the beginning.

### Why /studio2 didn't have this issue
The `/studio2` hook (`hooks/studio2/useOSMDStudio2.ts`) already had:
- `SheetMaximumWidth = MAX_SAFE_INTEGER`
- `RenderXMeasuresPerLineAkaSystem = 0`
- Progressive width retry loop (1M → 2M → 4M px)

### Fix
Ported the studio2 anti-wrapping logic to the studio hook.

### Important note
The MusicXML does NOT have repeat signs. All 160 measures are unique. The wrapping is purely a rendering width issue, not a repeat/volta issue.

### Files changed
- `hooks/useOSMD.ts` — ported anti-wrap logic from studio2

---

## Architecture Notes

### Audio flow
1. Audio URL stored in Supabase config
2. Loaded via `/api/asset?url=...` proxy (same-origin, avoids CORS)
3. Proxy fetches entire file upstream, returns as buffer (no range requests)
4. Audio element plays from this source
5. `PlaybackManager` wraps the audio element, provides `getTime()` / `getVisualTime()` / `seek()`

### Anchor/mapping flow
1. MusicXML loaded via OSMD → rendered as SVG score
2. `calculateNoteMap()` in ScrollView extracts XML events (measure, beat, pitches) from OSMD's GraphicSheet
3. MIDI file loaded and parsed → note events with `startTimeSec` (tempo-adjusted)
4. V5 AutoMapper (`AutoMapperV5.ts`) matches XML events to MIDI notes:
   - Iterates XML events in order
   - For each event, searches MIDI notes in a time window around the expected position
   - Matches by pitch, updates anchor time
   - If no match: dead-reckons using AQNTL (average quarter note time length)
5. Resulting `anchors` (measure-level) and `beatAnchors` (beat-level) stored in Zustand store and saved to Supabase
6. `findCurrentPosition(audioTime)` in ScrollView uses these anchors to map audio time → measure/beat/progress for cursor positioning

### Key files
| File | Purpose |
|------|---------|
| `hooks/useOSMD.ts` | OSMD hook for /studio |
| `hooks/studio2/useOSMDStudio2.ts` | OSMD hook for /studio2 |
| `components/studio2/score/ScrollViewStudio2.tsx` | Score rendering, cursor tracking, click-to-seek |
| `components/studio2/layout/SplitScreenLayoutStudio2.tsx` | Audio element setup, waterfall renderer |
| `lib/engine/PlaybackManager.ts` | Audio playback singleton (play/pause/seek/getTime) |
| `lib/engine/AutoMapperV5.ts` | V5 pitch-matching mapper (XML events → MIDI notes → anchors) |
| `app/studio2/edit/[id]/page.tsx` | Studio2 editor page, orchestrates mapping and playback |
| `app/api/asset/route.ts` | Audio/MIDI proxy (no range request support) |

---

## What Still Needs Fixing

### 1. V5 mapper wrong anchor at M10 — **FIXED 2026-04-05 (commit f636713)**
Root cause: tie-continuation notes in MusicXML were included in `xmlEventsList`,
creating phantom events the mapper searched for but MIDI never produced note-ons for.
Fix: filter out `sourceNote.NoteTie.Notes[0] !== sourceNote` notes in `calculateNoteMap`.

### 2. Dead-reckoned anchors past MIDI duration
After M25-M27, the mapper runs out of MIDI notes but keeps dead-reckoning using AQNTL=0.5s,
producing anchor times up to 328s. A stop condition was added but it may not trigger correctly
in all cases since `midiCursor` can still be within range while `lastAnchorTime` has diverged.

### 3. Diagnostic logging should be removed after M10 verification
Multiple debug logs were added during investigation and should be cleaned up once M10 fix is confirmed:
- `[M10 DEBUG findPos]` and `[M10 DEBUG updateCursor]` in ScrollViewStudio2.tsx
- `[ANCHOR DUMP]` in ScrollViewStudio2.tsx
- `[ScoreClick]` and `[ScrollContainer click]` in ScrollViewStudio2.tsx
- `[PM.seek]` in PlaybackManager.ts
- `[Studio2 Audio] PAUSE/STALLED/WAITING/SUSPEND/ENDED` in SplitScreenLayoutStudio2.tsx

### 4. Proxy should support range requests (NICE TO HAVE)
The asset proxy (`app/api/asset/route.ts`) doesn't support range requests. The blob URL
workaround handles this for now, but proper range request support would reduce memory usage
(no need to hold entire file as blob).
