# NEXUS Intelligent DJ System

A browser-based DJ workstation with a React/Vite frontend and a FastAPI audio-analysis backend.

## Requirements

- Windows 10/11
- Node.js 22.12 or newer (npm is included with Node.js)
- Python 3.12
- Internet access for the initial dependency installation

## Run on Windows

1. Install Node.js and Python 3.12 on the computer.
2. Copy the complete `NEXUS` folder to that computer.
3. Double-click `run-nexus.bat`.
   - On first launch, it creates a Python virtual environment, installs the backend and frontend dependencies, and opens the app and API in separate terminal windows.
   - Allow a few minutes for the first installation.
4. Open <http://localhost:5173> in Chrome or another modern browser.

Keep both terminal windows open while using the app. Close them to stop the frontend and analysis backend.

## Manual setup

From the project folder, install the backend and frontend dependencies:

```powershell
py -3.12 -m venv backend\venv
backend\venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Set-Location frontend
npm ci
```

Start the backend in one terminal:

```powershell
Set-Location backend
venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Start the frontend in a second terminal:

```powershell
Set-Location frontend
npm run dev -- --host 127.0.0.1
```

Then visit <http://localhost:5173>.

## Project structure

- `frontend\` — React interface, Web Audio playback/mixing, waveform visualization, and local browser track library.
- `backend\` — FastAPI audio-analysis API and its Python requirements.
- `run-nexus.bat` — Windows setup and launch helper.

The track library is stored in the browser's IndexedDB on each computer; it is not included when copying this project folder. Audio files selected for playback remain on the user's computer.

## Track library and transition picks

Use **Add Tracks** to keep audio files in the browser's local library. Select **Analyze Library** while both decks are paused to calculate and cache BPM, key, energy, waveform, and beat-grid metadata for imported tracks. The recommendations compare un-loaded library tracks with the playing deck (or, if both decks are paused, the more audible loaded deck), then rank candidates by tempo compatibility, Camelot key relation, and energy difference. Use **Load A/B** or **Queue** directly from a recommendation. Analysis requires the local FastAPI backend to be running.

For manual grid correction, unlock **BEAT GRID**, turn **GRID EDIT** on, then click or drag the large waveform to set Beat 1. The deck's **GRID BPM** field and half/double controls correct the tempo model; edits are saved to the existing IndexedDB track record when the track is in the local library. With Grid Edit off, the large waveform seeks/scrubs as usual. **QUANTIZE** optionally snaps waveform seeks, cue jumps, and playback starts to the current track grid. The compact waveform in each deck also seeks/scrubs through the analyzed full-track peaks.

The beat-alignment panel separately displays bar/beat phase offset, estimated milliseconds, and effective BPM difference. `ALIGNED · 0.00 BEAT` is shown only when the analyzed-grid phase error is below 0.005 beat and the effective BPM difference is below 0.05 BPM. Each deck also has a local Sync button (`SYNC TO B` / `SYNC TO A`) to sync that deck directly to the other deck's current effective BPM, including its pitch adjustment. Beat/bar position is calculated from each track's media position and analyzed grid; playback rate changes how quickly that position advances, not where it lies in the source track. Sync can be pressed before playback: it matches the target tempo and positions a stopped deck on the analyzed grid, then arms soft sync to engage when both decks play. During playback, Sync matches the tempo within the selected pitch range and applies a small, reversible phase-bend (up to 4%) until the analyzed grids align; it does not seek or restart playing audio. Seeking, nudging, changing the pitch control, or pausing releases soft sync so manual controls remain in charge. If a BPM transition changes the active sync reference deck, the other deck follows its tempo ramp and remains phase-corrected. Beat loops are measured in source-track time, so changing pitch does not change their beat length. BPM transitions start at the next grid beat and advance their selected bar count using the audio element's actual media-time progress, so the ramp follows musical beats rather than a wall-clock timer. Automatic transition BPM continues to use the first queued track. Keyboard mappings include `A` / `L` for Deck A/B play, `Q` / `P` for Deck A/B cue, `S` / `K` for sync, `Z` / `X` and `N` / `M` for deck nudges, and arrow keys for fine active-deck phase/tempo adjustment.

## Troubleshooting

- If `run-nexus.bat` says Node.js or Python is missing, install the required version and open a new terminal before retrying.
- If the frontend or API ports are already in use, stop the other application using port `5173` or `8000`, then launch again.
- The first dependency installation requires an internet connection. After installation, the app can run locally.
