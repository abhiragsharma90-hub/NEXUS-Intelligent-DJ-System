from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import librosa
import numpy as np
import tempfile
import asyncio
import os

app = FastAPI(title="Intelligent DJ System Audio Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pitch to Camelot Wheel mapping
CAMELOT_MAP = {
    'C Major': '8B',  'A Minor': '8A',
    'G Major': '9B',  'E Minor': '9A',
    'D Major': '10B', 'B Minor': '10A',
    'A Major': '11B', 'F# Minor': '11A',
    'E Major': '12B', 'C# Minor': '12A',
    'B Major': '1B',  'G# Minor': '1A',
    'F# Major': '2B', 'D# Minor': '2A',
    'Db Major': '3B', 'Bb Minor': '3A',
    'Ab Major': '4B', 'F Minor': '4A',
    'Eb Major': '5B', 'C Minor': '5A',
    'Bb Major': '6B', 'G Minor': '6A',
    'F Major': '7B',  'D Minor': '7A'
}

KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
WAVEFORM_BINS = 1200
PCM_WAVEFORM_BINS = 2400
BEAT_HOP_LENGTH = 128


def _downsample_peak(values, bins=WAVEFORM_BINS):
    if values.size == 0:
        return []
    chunks = np.array_split(values, min(bins, values.size))
    peak = np.asarray([np.max(chunk) for chunk in chunks], dtype=np.float32)
    ceiling = float(np.percentile(peak, 99.5))
    if ceiling > 0:
        peak = np.clip(peak / ceiling, 0, 1)
    return np.round(peak, 4).tolist()


def _downsample_pcm(samples, bins=PCM_WAVEFORM_BINS):
    if samples.size == 0:
        return np.empty((0, 2), dtype=np.float32)
    chunks = np.array_split(samples, min(bins, samples.size))
    return np.asarray(
        [(np.min(chunk), np.max(chunk)) for chunk in chunks],
        dtype=np.float32,
    )


def analyze_waveform(y, sr, beat_frames, channels=None, hop_length=512, beat_hop_length=BEAT_HOP_LENGTH, bpm=None):
    spectrum = np.abs(librosa.stft(y=y, n_fft=2048, hop_length=hop_length))
    frequencies = librosa.fft_frequencies(sr=sr, n_fft=2048)
    bands = {}
    for name, lower, upper in (
        ('low', 0, 180),
        ('mid', 180, 2500),
        ('high', 2500, sr / 2 + 1),
    ):
        selected = (frequencies >= lower) & (frequencies < upper)
        band_energy = np.sqrt(np.mean(spectrum[selected] ** 2, axis=0)) if np.any(selected) else np.zeros(spectrum.shape[1])
        bands[name] = _downsample_peak(band_energy)

    frame_energy = librosa.feature.rms(S=spectrum, frame_length=2048)[0]
    energy = _downsample_peak(frame_energy)
    duration = librosa.get_duration(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=beat_hop_length)
    first_beat_time = float(beat_times[0]) if len(beat_times) else 0.0
    beat_interval = 60 / bpm if bpm and bpm > 0 else None
    grid_positions = (
        np.arange(first_beat_time, duration, beat_interval)
        if beat_interval
        else beat_times
    )
    if channels is None:
        channels = np.stack((y, y))
    elif channels.ndim == 1:
        channels = np.stack((channels, channels))
    channel_peaks = [
        _downsample_pcm(channels[0]),
        _downsample_pcm(channels[min(1, channels.shape[0] - 1)]),
    ]
    absolute_peaks = np.concatenate([np.max(np.abs(channel), axis=1) for channel in channel_peaks])
    ceiling = float(np.percentile(absolute_peaks, 99.9)) if absolute_peaks.size else 0
    peaks = {}
    for name, channel in zip(('left', 'right'), channel_peaks):
        normalized = np.clip(channel / ceiling, -1, 1) if ceiling > 0 else channel
        peaks[name] = np.round(normalized, 4).tolist()
    sections = []
    section_count = min(48, max(1, int(np.ceil(duration / 12))))
    for index, start in enumerate(np.linspace(0, duration, section_count, endpoint=False)):
        end = duration if index == section_count - 1 else min(duration, start + duration / section_count)
        first = int(start / duration * frame_energy.size) if duration else 0
        last = max(first + 1, int(end / duration * frame_energy.size)) if duration else 1
        level = float(np.mean(frame_energy[first:last])) if frame_energy.size else 0
        nearby = sections[-1]['energy'] if sections else level
        if level < float(np.percentile(frame_energy, 25)):
            label = 'LOW ENERGY'
        elif level > float(np.percentile(frame_energy, 75)):
            label = 'HIGH ENERGY'
        elif level > nearby * 1.18:
            label = 'BUILD'
        else:
            label = 'GROOVE'
        sections.append({'time': round(float(start), 2), 'label': label, 'energy': round(level, 4)})

    return {
        'duration': round(float(duration), 3),
        'peaks': peaks,
        'bands': bands,
        'energy': energy,
        'beats': np.round(beat_times, 3).tolist(),
        'beatPositions': np.round(grid_positions, 3).tolist(),
        'barPositions': np.round(grid_positions[::4], 3).tolist(),
        'firstBeatTime': round(first_beat_time, 3),
        'beatInterval': round(beat_interval, 6) if beat_interval else None,
        'timeSignature': [4, 4],
        'sections': sections,
    }

def detect_key_and_camelot(y, sr):
    chroma = librosa.feature.chroma_stft(y=y, sr=sr)
    chroma_mean = np.mean(chroma, axis=1)
    
    # Identify dominant pitch class
    key_idx = int(np.argmax(chroma_mean))
    root_key = KEYS[key_idx]
    
    # Estimate mode (Major vs Minor) using spectral feature energy balance
    spectral_centroid = np.mean(librosa.feature.spectral_centroid(y=y, sr=sr))
    mode = 'Major' if spectral_centroid > 2000 else 'Minor'
    
    full_key = f"{root_key} {mode}"
    camelot = CAMELOT_MAP.get(full_key, f"{root_key}")
    return full_key, camelot

@app.get("/")
def read_root():
    return {"status": "DJ Audio Processing Service Running"}

def _analyze_track_file(tmp_path, filename):
    try:
        audio, sr = librosa.load(tmp_path, sr=11025, mono=False)
        channels = audio if audio.ndim > 1 else np.stack((audio, audio))
        y = librosa.to_mono(audio) if audio.ndim > 1 else audio
        
        # Analyze the full track so beat markers and the overview waveform share one timeline.
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=BEAT_HOP_LENGTH)
        bpm = float(tempo[0]) if isinstance(tempo, np.ndarray) else float(tempo)
        waveform = analyze_waveform(
            y,
            sr,
            beat_frames,
            channels=channels,
            beat_hop_length=BEAT_HOP_LENGTH,
            bpm=bpm,
        )
        
        # 2. Key & Camelot
        full_key, camelot_key = detect_key_and_camelot(y, sr)
        
        # 3. Energy Level (RMS Energy scaled 1-10)
        rms = float(np.mean(librosa.feature.rms(y=y)))
        energy_score = min(10, max(1, round(rms * 100)))

        return {
            "filename": filename,
            "bpm": round(bpm, 1),
            "key": camelot_key,
            "musical_key": full_key,
            "energy": energy_score,
            "waveform": waveform,
            "status": "success"
        }
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.post("/analyze")
async def analyze_track(file: UploadFile = File(...)):
    contents = await file.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=".audio") as tmp:
        tmp.write(contents)
        tmp_path = tmp.name
    return await asyncio.to_thread(_analyze_track_file, tmp_path, file.filename)