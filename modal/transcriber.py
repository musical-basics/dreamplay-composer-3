"""
Modal Serverless GPU Transcriber — ByteDance Piano Transcription
Deploy: modal deploy modal/transcriber.py
Test:   modal run modal/transcriber.py
URL:    https://<your-workspace>--pianist-v3-transcriber-transcribe.modal.run
"""
import modal
from fastapi import Response
from pydantic import BaseModel
import tempfile
import urllib.request
import os

# ---------------------------------------------------------------------------
# 1. Container image — installs PyTorch + ByteDance model + ffmpeg
# ---------------------------------------------------------------------------
image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("ffmpeg")
    .pip_install("torch", "piano_transcription_inference", "librosa")
)

app = modal.App("pianist-v3-transcriber")


class TranscribeRequest(BaseModel):
    audio_url: str  # Public or presigned R2/S3 URL to the .wav file


# ---------------------------------------------------------------------------
# 2. Serverless GPU function — cold-starts in ~1s on T4, auto-scales to 0
# ---------------------------------------------------------------------------
@app.function(image=image, gpu="T4", timeout=600)
@modal.web_endpoint(method="POST")
def transcribe(req: TranscribeRequest):
    from piano_transcription_inference import PianoTranscription, load_audio

    # Download audio from the provided URL (Cloudflare R2, S3, etc.)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_audio:
        req_obj = urllib.request.Request(
            req.audio_url, headers={"User-Agent": "Mozilla/5.0"}
        )
        tmp_audio.write(urllib.request.urlopen(req_obj).read())
        audio_path = tmp_audio.name

    # Run ByteDance inference — generates high-accuracy MIDI with pedal data
    audio, _ = load_audio(audio_path, sr=16000, mono=True)
    transcriptor = PianoTranscription(device="cuda")

    midi_path = audio_path.replace(".wav", ".mid")
    transcriptor.transcribe(audio, midi_path)

    # Read MIDI binary into memory
    with open(midi_path, "rb") as f:
        midi_data = f.read()

    # Cleanup temp files
    os.remove(audio_path)
    os.remove(midi_path)

    # Return raw MIDI over HTTP — no AWS keys needed on this side
    return Response(content=midi_data, media_type="audio/midi")
