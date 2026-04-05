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

### Root cause (UNRESOLVED)
The V5 mapper fails to match MIDI notes at M10 for this specific piece. This could be:
1. The search window is too narrow at M9-M10
2. The XML pitches at M10 don't align with the MIDI pitches at the expected time
3. The AQNTL estimate drifts, causing the search window to miss the correct notes
4. Some interaction between the two piano staves creating ambiguous pitch matches

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

### 1. V5 mapper fails at M10 for this piece (HIGH PRIORITY)
The mapper consistently places M10 at t=20.3 instead of ~17.4. The outlier gap detection in `findCurrentPosition` is a workaround but the mapper itself should produce correct anchors. Need to investigate:
- What MIDI pitches exist at t=16.4-17.5 (where M10 should be)
- What XML pitches M10 expects
- Why the search window misses the correct match
- Whether the AQNTL drift is causing the window to be in the wrong position

### 2. Dead-reckoned anchors past MIDI duration
After M25-M27, the mapper runs out of MIDI notes but keeps dead-reckoning using AQNTL=0.5s, producing anchor times up to 328s. A stop condition was added (`state.midiCursor >= sorted.length && state.lastAnchorTime > midiDuration`) but it may not trigger correctly in all cases since `midiCursor` can still be within range while `lastAnchorTime` has diverged.

### 3. Diagnostic logging should be removed
Multiple debug logs were added during investigation and should be cleaned up once the issues are resolved:
- `[M10 DEBUG findPos]` and `[M10 DEBUG updateCursor]` in ScrollViewStudio2.tsx
- `[ANCHOR DUMP]` in ScrollViewStudio2.tsx
- `[ScoreClick]` and `[ScrollContainer click]` in ScrollViewStudio2.tsx
- `[PM.seek]` in PlaybackManager.ts
- `[Studio2 Audio] PAUSE/STALLED/WAITING/SUSPEND/ENDED` in SplitScreenLayoutStudio2.tsx

### 4. Proxy should support range requests (NICE TO HAVE)
The asset proxy (`app/api/asset/route.ts`) doesn't support range requests. The blob URL workaround handles this for now, but proper range request support would reduce memory usage (no need to hold entire file as blob).
