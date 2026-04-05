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
