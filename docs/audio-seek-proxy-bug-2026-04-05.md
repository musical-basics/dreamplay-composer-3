# Audio Seek Failure via Proxy — 2026-04-05

## Bug
Clicking on a measure in Studio2 to seek/scroll to that position did nothing. The audio stayed at its current position (or reset to 0). Playback from the beginning worked, but any `audio.currentTime = X` assignment silently failed.

## Cause
The audio was loaded through the asset proxy (`/api/asset?url=...`) which:
1. Fetches the entire upstream file
2. Returns it as a single response with `Cache-Control: no-store` and no range request support

Without range request support, the browser's `<audio>` element cannot seek within the audio data. Setting `currentTime` triggers an internal seek operation that requires byte-range access to the media. When the browser can't perform this, it silently resets `currentTime` to 0.

The `PlaybackManager.seek()` method showed:
```
requested=5.854  clamped=5.854  readyState=4  currentTime=1.913
after set: currentTime=0
```
`readyState=4` (HAVE_ENOUGH_DATA) confirmed the audio was loaded, but seeking still failed due to missing range support.

### Secondary issue
`PlaybackManager.seek()` also had a clamping bug: `Math.min(timeSec, this._duration)` where `_duration` could be 0 if audio metadata hadn't loaded yet, clamping all seeks to 0.

## Failed Fixes
1. **Adding `Content-Length` and `Accept-Ranges: none` headers to proxy** — Did not help. The browser still couldn't seek because range requests weren't actually supported.
2. **Changing `preload` from `'metadata'` to `'auto'`** — Helped with buffering but did not fix seeking.
3. **Fixing `_duration` clamping in `PlaybackManager.seek()`** — Correct fix but didn't address the underlying seek failure.

## Final Fix
**Load audio as a blob URL instead of streaming from the proxy.**

In `SplitScreenLayoutStudio2.tsx`, instead of:
```js
const audio = new Audio(proxiedAudioUrl)
```

Changed to:
```js
const audio = new Audio()
fetch(proxiedAudioUrl)
  .then(res => res.blob())
  .then(blob => {
    blobUrl = URL.createObjectURL(blob)
    audio.src = blobUrl
  })
```

### Why it works
A `blob:` URL gives the browser full random access to the in-memory audio data. No range requests needed — the entire file is already in the browser's memory as a Blob. The browser can seek to any position instantly.

### Cleanup
The blob URL is revoked via `URL.revokeObjectURL(blobUrl)` in the useEffect cleanup to prevent memory leaks.

## Files Changed
- `components/studio2/layout/SplitScreenLayoutStudio2.tsx` — blob URL audio loading
- `lib/engine/PlaybackManager.ts` — seek clamping fix (use `audioElement.duration` instead of `_duration`)
- `app/api/asset/route.ts` — added `Content-Length` header (good practice, not the fix)
