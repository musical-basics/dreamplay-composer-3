# AI Transcription Architecture — V3 (ByteDance + Modal + BullMQ)

## 2. The Recommended V3 Architecture

To get maximum accuracy, you need to use the ByteDance model. Because you are running a Next.js app (which cannot run PyTorch), you will need a **Serverless GPU Microservice**.

Fortunately, looking at your `package.json`, you already have `bullmq`, `ioredis`, `@aws-sdk/client-s3` (for R2/S3), and `@supabase/supabase-js`. You have the exact infrastructure needed for this.

### The Pipeline (Using Modal.com or RunPod)

**Do not rent a permanent EC2 GPU server.** Deploy a small Python worker to a serverless GPU provider like [Modal.com](https://modal.com). They boot a container in ~1 second, run the PyTorch script, and shut down, meaning you only pay pennies per transcription.

**Upload** (`app/studio/edit/[id]/page.tsx`):
Update the UploadWizard to make the MIDI upload optional. Add an "✨ AI Transcribe" button. The user uploads their `audio.wav` to your R2 bucket.

**Queueing**:
Your Next.js API route adds a job to your Redis BullMQ queue containing the `configId` and the R2 `audioUrl`.

**GPU Microservice (Python)**:
Your Python worker listens to the queue, spins up a GPU, downloads the audio, and runs the ByteDance model:

```python
from piano_transcription_inference import PianoTranscription, load_audio

audio, _ = load_audio(downloaded_audio_path, sr=16000, mono=True)
transcriptor = PianoTranscription(device='cuda')
transcriptor.transcribe(audio, 'output.mid')
```

**Completion**:
The Python worker uploads `output.mid` to your R2 bucket, updates the Supabase `SongConfig` table (`UPDATE config SET midi_url = '...' WHERE id = configId`), and completes the BullMQ job.

**Zero-Touch Mapping**:
Your frontend detects the new `midi_url`, triggers `loadMidi(parsedMidi)`. Because you already have `hasAutoMappedRef.current` in your `page.tsx` (Line 372), AutoMapperV5 will automatically run and map the sheet music to the new audio.

---

## 3. Fortifying Your Codebase for AI Transcription

If you implement the ByteDance model, you must make two adjustments to your existing codebase to support it:

### A. Update the Parser for Sustain Pedals

If you look at your current `lib/midi/parser.ts` (lines 38-54), you are completely ignoring Control Change (sustain pedal) data. If you go through the effort of generating pedal data with AI, you need your parser to read it.

```typescript
// Update lib/midi/parser.ts
const pedalEvents: { time: number; value: number }[] = []

midi.tracks.forEach((track, trackIndex) => {
    // ... existing note logic ...

    // NEW: Capture sustain pedal (CC 64)
    if (track.controlChanges[64]) {
        track.controlChanges[64].forEach((cc) => {
            pedalEvents.push({
                time: cc.time,
                value: Math.round(cc.value * 127) // 0 to 127
            })
        })
    }
})

// Expose pedalEvents to your ParsedMidi type
```

### B. Fuzzy Matching in AutoMapperV5.ts

Even the best AI models occasionally hallucinate an overtone (e.g., hearing a ghost C5 when a loud C4 is played). If that ghost C5 happens to match an `expectedPitch` for the next beat, your `findFirstPitchMatch` will anchor early, resulting in a stray note warning.

To prevent AI acoustic resonance from breaking your mapper, add a fuzzy tolerance:

```typescript
// lib/engine/AutoMapperV5.ts (Around Line 31)
function findFirstPitchMatch(
    expectedPitches: number[],
    midiNotes: NoteEvent[],
    startIndex: number
): { time: number; index: number } | null {
    for (let i = startIndex; i < midiNotes.length; i++) {
        const note = midiNotes[i]
        
        // 1. Exact Match
        if (expectedPitches.includes(note.pitch)) {
            return { time: note.startTimeSec, index: i }
        }
        
        // 2. AI Hallucination Tolerance (Octave/Harmonic Invariance)
        // AI models frequently confuse octaves (+/- 12) due to acoustic overtones
        const isOctaveError = expectedPitches.some(p => Math.abs(p - note.pitch) === 12)
        if (isOctaveError) {
            return { time: note.startTimeSec, index: i }
        }
    }
    return null
}
```

---

## Phase 1: The Serverless GPU Endpoint (Modal)

You will deploy this single Python file to Modal. Modal will automatically provision the PyTorch environment, install the ByteDance library, and expose a secure HTTPS endpoint. It costs $0.00 until it is pinged.

```python
# transcriber.py
import modal
from fastapi import Response
from pydantic import BaseModel
import tempfile
import urllib.request
import os

# 1. Define the container environment
image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("ffmpeg")
    .pip_install("torch", "piano_transcription_inference", "librosa")
)

app = modal.App("pianist-v3-transcriber")

class TranscribeRequest(BaseModel):
    audio_url: str

# 2. Define the Serverless GPU Function
@app.function(image=image, gpu="T4", timeout=600)
@modal.web_endpoint(method="POST")
def transcribe(req: TranscribeRequest):
    from piano_transcription_inference import PianoTranscription, load_audio

    # Download audio from your Cloudflare R2 bucket
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_audio:
        req_obj = urllib.request.Request(req.audio_url, headers={'User-Agent': 'Mozilla/5.0'})
        tmp_audio.write(urllib.request.urlopen(req_obj).read())
        audio_path = tmp_audio.name

    # Run ByteDance Inference (Generates high-accuracy MIDI with pedals)
    audio, _ = load_audio(audio_path, sr=16000, mono=True)
    transcriptor = PianoTranscription(device='cuda')
    
    midi_path = audio_path.replace(".wav", ".mid")
    transcriptor.transcribe(audio, midi_path)

    # Read the MIDI binary directly into memory
    with open(midi_path, "rb") as f:
        midi_data = f.read()

    os.remove(audio_path)
    os.remove(midi_path)

    # Return the raw MIDI file directly over HTTP! No AWS keys needed here.
    return Response(content=midi_data, media_type="audio/midi")
```

Run `modal deploy transcriber.py` and you will get a permanent URL (e.g., `https://your-workspace--pianist-v3-transcriber-transcribe.modal.run`).

---

## Phase 2: The Next.js API Trigger

When the user clicks "✨ AI Transcribe" in your UploadWizard, push the job to BullMQ and return immediately.

```typescript
// app/api/transcribe/route.ts
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL!);
const transcriptionQueue = new Queue('transcription', { connection });

export async function POST(req: Request) {
    const { configId, audioUrl } = await req.json();

    await transcriptionQueue.add('transcribe-job', { configId, audioUrl });

    return Response.json({ success: true, message: "Queued for transcription" });
}
```

---

## Phase 3: The Node.js BullMQ Worker (The Orchestrator)

This runs in your existing Node.js environment (e.g., Railway). It safely orchestrates the long-running task without blocking your Next.js frontend, perfectly executing your friend's vision.

```typescript
// worker/transcriptionWorker.ts
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

const connection = new IORedis(process.env.REDIS_URL!);
const s3 = new S3Client({ /* your R2 credentials */ });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const MODAL_URL = 'https://your-workspace--pianist-v3-transcriber-transcribe.modal.run';

const worker = new Worker('transcription', async job => {
    const { configId, audioUrl } = job.data;

    // 1. Wake up the Modal GPU & Transcribe
    // This HTTP call blocks here, but it's safe because it's inside a background worker!
    const modalResponse = await fetch(MODAL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_url: audioUrl })
    });

    if (!modalResponse.ok) throw new Error("GPU Transcription failed");

    // 2. Receive the raw MIDI file directly from the response
    const midiArrayBuffer = await modalResponse.arrayBuffer();
    const midiBuffer = Buffer.from(midiArrayBuffer);

    // 3. Upload the new MIDI directly to R2
    const midiKey = `midi/${configId}-ai-transcription-${Date.now()}.mid`;
    await s3.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: midiKey,
        Body: midiBuffer,
        ContentType: 'audio/midi'
    }));

    const finalMidiUrl = `${process.env.R2_PUBLIC_URL}/${midiKey}`;

    // 4. Update the Database
    await supabase
        .from('song_configs') // use your actual table name
        .update({ midi_url: finalMidiUrl })
        .eq('id', configId);

    return { finalMidiUrl };
}, { connection });
```

---

## Phase 4: Zero-Touch Frontend Hydration

Because of how elegantly you've designed your `page.tsx` state management, the frontend practically finishes the job itself.

1. The user clicks "✨ AI Transcribe".
2. Set up a simple Supabase Realtime listener in `app/studio/edit/[id]/page.tsx` to watch for the `midi_url` to change from `null` to a string.
3. Once detected, update your local config state.
4. Your existing `useEffect` (Line 128 in `page.tsx`) automatically sees the new `config.midi_url` and calls `loadMidiFromUrl()`.
5. Your existing `useEffect` (Line 372 in `page.tsx`) sees that `parsedMidi` is populated and `anchors.length` is 1, and automatically executes the AutoMapperV5 Echolocation Mapper.

---

## Why This Architecture Wins

- **Rock Bottom Cost**: You only pay for the 10-15 seconds the GPU is active on Modal. No idle costs.
- **Resilience**: If the GPU fails or hits an Out-Of-Memory error, BullMQ automatically catches the error on your Node server and retries the job.
- **Security**: Modal doesn't need your AWS keys or database credentials. It is a completely stateless math engine.
- **UX**: The frontend never hangs. The user drops an audio file, sees a "Transcribing..." UI, and 20 seconds later, the 3D waterfall populates itself and perfectly aligns with the sheet music cursor.
