# Bug: OSMD fails to load MXL files — "Invalid MXL file" / "The document which was provided is invalid"

**Date:** 2026-04-04

## Symptom
Sheet music view shows error: `Error loading score: OpenSheetMusicDisplay: Invalid MXL file` (or later, `The document which was provided is invalid`). The score spinner stays visible indefinitely.

## Root Cause
Two compounding issues:

1. **Upload service renames all score files to `score.xml`** (`lib/services/configService.ts:60`), so the R2 URL never contains `.mxl` even when the original upload was an MXL file.
2. **OSMD's `load()` method does not accept raw `ArrayBuffer`** — its signature is `string | Blob | Document`. Passing an `ArrayBuffer` causes OSMD to treat it as an invalid document.

## Failed Fixes

### Attempt 1: URL-based MXL detection (commit `a0d88f6`)
Checked `url.toLowerCase().includes('.mxl')` and fetched via proxy as binary `ArrayBuffer`, then passed to `osmd.load(buffer)`.
- **Why it failed:** The URL is always `score.xml` (never `.mxl`), so the detection never matched. The `else` branch passed the URL string directly — OSMD fetched MXL binary but failed to handle it internally.

### Attempt 2: Content-based detection with ArrayBuffer (commit `8127b8e`)
Fetched the file, inspected ZIP magic bytes (`0x50 0x4B`) to detect MXL, then passed the `ArrayBuffer` to `osmd.load()`.
- **Why it failed:** OSMD's `load()` does not accept `ArrayBuffer`. It silently fails to interpret the data, throwing "The document which was provided is invalid".

## Final Solution (commit `9da8859`)
Fetch the file, detect MXL by ZIP magic bytes, then wrap the `ArrayBuffer` in a `Blob` before passing to OSMD:

```typescript
const response = await fetch(url)
const buffer = await response.arrayBuffer()
const bytes = new Uint8Array(buffer)
const isZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B

if (isZip) {
    const blob = new Blob([buffer], { type: 'application/vnd.recordare.musicxml' })
    await osmd.load(blob)
} else {
    const decoder = new TextDecoder()
    await osmd.load(decoder.decode(buffer))
}
```

**Why it worked:** `Blob` is in OSMD's accepted input types. Internally, OSMD calls `blob.arrayBuffer()` and routes the data through JSZip for MXL decompression. This also removes dependence on file extensions, making it work regardless of how the file is stored.

## Files Changed
- `hooks/useOSMD.ts`
- `hooks/useOSMD-v2.ts`
- `app/studio/edit/[id]/page.tsx` (loading screen condition fix — separate issue)

---

# Follow-up Bug: Local editors fail to fetch score, MIDI, or audio from remote asset URLs

**Date:** 2026-04-05

## Symptom
- Live `/studio/edit` showed `Error loading score: Failed to fetch`.
- Live MIDI loading failed inside `loadMidiFromUrl`, which also broke the waterfall renderer.
- Pressing spacebar to play could throw `Runtime NotSupportedError: The element has no supported sources.`
- Studio2 later showed the same fetch failures for score, MIDI, and transport audio.

## Root Cause
The editor had moved to content-based file loading for OSMD and MIDI parsing, but the browser was still fetching remote R2 asset URLs directly from localhost.

That created three related failure modes:

1. **Score loading:** `fetch(xmlUrl)` in the browser could fail due to cross-origin or signed-URL constraints.
2. **MIDI loading:** `fetch(midiUrl)` in the browser could fail for the same reason, leaving `parsedMidi` empty and breaking the waterfall.
3. **Audio playback:** `new Audio(audioUrl)` pointed the media element at the raw remote URL. When the browser could not recognize or access that source cleanly, pressing play or spacebar failed with `The element has no supported sources.`

## Failed Fixes

### Attempt 1: Fix only Studio2 scroll and wrapping logic
- **Why it failed:** It improved rendering behavior but did not address the actual fetch architecture. The broken parts were upstream asset loading, not cursor/scroll behavior.

### Attempt 2: Fix only live score loading via proxied XML
- **Why it failed:** `/studio/edit` score loading recovered, but MIDI and audio still used raw remote URLs, so the waterfall and transport remained broken.

### Attempt 3: Fix only live MIDI loading via proxied asset route
- **Why it failed:** The waterfall recovered, but the transport still instantiated `new Audio(audioUrl)` directly, so spacebar playback could still fail with unsupported-source errors.

## Final Solution
Move all browser-facing asset access behind internal server routes and keep the browser talking only to same-origin URLs.

### Score
- Route MusicXML and MXL requests through `/api/xml?url=...`.

### MIDI
- Route MIDI downloads through `/api/asset?url=...` before parsing with `parseMidiFile()`.

### Audio
- Build the transport audio element from `/api/asset?url=...` instead of the raw remote asset URL.
- Infer browser-friendly MIME types in the proxy when upstream responses return weak or generic content types.

### Diagnostics
- Added explicit audio metadata and media-error logging so future failures reveal the actual source URL, proxy URL, and browser media error code.

## Why it worked
This fixes the architecture instead of layering more browser-side exceptions on top of remote asset URLs.

- The browser now only requests same-origin `/api/...` routes.
- The server performs the remote fetch and returns the asset with a stable response shape.
- OSMD, MIDI parsing, waterfall initialization, and the audio transport all consume the same-origin proxied data.
- Audio playback becomes reliable because the proxied response includes a recognizable content type instead of relying on whatever upstream headers happen to be present.

## Files Changed
- `hooks/useOSMD.ts`
- `app/api/xml/route.ts`
- `app/api/asset/route.ts`
- `app/studio/edit/[id]/page.tsx`
- `components/layout/SplitScreenLayout.tsx`
- `hooks/studio2/useOSMDStudio2.ts`
- `app/studio2/edit/[id]/page.tsx`
- `components/studio2/layout/SplitScreenLayoutStudio2.tsx`

---

# Follow-up Bug: AutoMap fails in `getAudioOffset` with `Failed to fetch`

**Date:** 2026-04-05

## Symptom
- During final setup (after file uploads), pressing AI mapping/transcribe flow could fail with:
    - `Console TypeError: Failed to fetch`
    - stack pointing to `getAudioOffset` inside `handleAutoMap`.

## Root Cause
The upload/playback/loading paths had already been moved to same-origin proxy routes, but `getAudioOffset()` still fetched `audio_url` directly from the remote asset URL in the browser.

On localhost, that direct fetch can fail for the same reasons as earlier asset-loading regressions.

## Final Solution
- Route audio offset analysis through the same internal proxy path used by playback and MIDI loading:
    - `fetch('/api/asset?url=...')` instead of `fetch(audioUrl)`.
- Added explicit diagnostics for:
    - source URL and proxied URL
    - fetch response status
    - decoded buffer metadata (sample rate, frame count, duration)

## Why it worked
This removed the last direct browser dependency on remote asset URLs in the mapping flow, so AutoMap now uses the same stable same-origin fetch architecture as other editor subsystems.

## File Changed
- `lib/engine/AudioHelpers.ts`
