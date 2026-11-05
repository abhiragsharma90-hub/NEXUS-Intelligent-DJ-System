import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, RotateCw } from 'lucide-react';

const DECKS = [
  { id: 'A', color: '#42d6b1' },
  { id: 'B', color: '#b19aff' },
];
const BAND_COLORS = ['#e1a94f', '#4dd4a1', '#63adff'];

export default function AnalyzedWaveforms({
  audioARef,
  audioBRef,
  tracks,
  onSeek,
  gridEdit,
  gridLocked,
  onSetBeatOne,
}) {
  const canvasRef = useRef(null);
  const latestRef = useRef({ audioARef, audioBRef, tracks, onSeek, onSetBeatOne, gridEdit, gridLocked });
  const dragRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);

  useEffect(() => {
    latestRef.current = { audioARef, audioBRef, tracks, onSeek, onSetBeatOne, gridEdit, gridLocked };
  }, [audioARef, audioBRef, tracks, onSeek, onSetBeatOne, gridEdit, gridLocked]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    let animationFrame;

    let previousFrame = 0;
    const render = (timestamp) => {
      if (document.visibilityState === 'visible' && timestamp - previousFrame >= 50) {
      previousFrame = timestamp;
      const { audioARef: currentAudioA, audioBRef: currentAudioB, tracks: currentTracks } = latestRef.current;
      const bounds = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(bounds.width * scale));
      const height = Math.max(1, Math.floor(bounds.height * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.fillStyle = '#090c0e';
      context.fillRect(0, 0, bounds.width, bounds.height);
      const laneHeight = bounds.height / 2;

      DECKS.forEach(({ id, color }, laneIndex) => {
        const audio = (id === 'A' ? currentAudioA : currentAudioB).current;
        const track = currentTracks[id];
        const analysis = track.analysis;
        const duration = audio?.duration && Number.isFinite(audio.duration) ? audio.duration : analysis?.duration || 0;
        const position = audio?.currentTime || 0;
        const beatSeconds = track.bpm > 0 ? 60 / track.bpm : 0.5;
        const beatsPerView = 32 / zoomRef.current;
        const span = beatsPerView * beatSeconds;
        const start = position - span / 2;
        const end = start + span;
        const laneTop = laneIndex * laneHeight;
        const centerY = laneTop + laneHeight * 0.56;
        const waveHeight = laneHeight * 0.37;
        const bands = analysis?.bands;
        const energy = analysis?.energy;
        const pcmPeaks = analysis?.peaks;

        context.fillStyle = laneIndex === 0 ? '#101816' : '#14121b';
        context.fillRect(0, laneTop, bounds.width, laneHeight);
        context.fillStyle = color;
        context.globalAlpha = 0.8;
        context.font = 'bold 10px monospace';
        context.fillText(`DECK ${id}  ${track.bpm > 0 ? `${(track.bpm * track.playbackRate).toFixed(1)} BPM` : 'LOAD TRACK FOR BEAT GRID'}${pcmPeaks?.left?.length ? ' · PCM' : ''}`, 10, laneTop + 15);
        context.globalAlpha = 1;

        const anchor = analysis?.firstBeatTime ?? analysis?.beats?.[0] ?? 0;
        if (duration > 0 && track.bpm > 0) {
          const firstBeat = Math.ceil((start - anchor) / beatSeconds);
          const lastBeat = Math.floor((end - anchor) / beatSeconds);
          for (let beatIndex = firstBeat; beatIndex <= lastBeat; beatIndex += 1) {
          const beatTime = anchor + beatIndex * beatSeconds;
          const x = ((beatTime - start) / span) * bounds.width;
          const bar = ((beatIndex % 4) + 4) % 4 === 0;
          const phrase = ((beatIndex % 16) + 16) % 16 === 0;
          context.beginPath();
          context.moveTo(x, laneTop + (phrase ? 2 : 19));
          context.lineTo(x, laneTop + laneHeight - 3);
          context.strokeStyle = phrase ? `${color}bb` : bar ? 'rgba(214,225,221,0.34)' : 'rgba(214,225,221,0.12)';
          context.lineWidth = phrase ? 1.4 : bar ? 1 : 0.65;
          context.stroke();
          context.fillStyle = bar ? `${color}dd` : 'rgba(214,225,221,0.62)';
          context.font = bar ? 'bold 8px monospace' : '7px monospace';
          context.fillText(String(((beatIndex % 4) + 4) % 4 + 1), x + 2, laneTop + 28);
          }
        }

        context.fillStyle = 'rgba(255,255,255,0.025)';
        context.fillRect(0, centerY - waveHeight, bounds.width, waveHeight * 2);
        const binCount = pcmPeaks?.left?.length || bands?.low?.length || 0;
        if (duration > 0 && binCount > 0) {
          if (pcmPeaks?.left?.length) {
            const channels = [
              { peaks: pcmPeaks.left, center: laneTop + laneHeight * 0.43 },
              { peaks: pcmPeaks.right || pcmPeaks.left, center: laneTop + laneHeight * 0.76 },
            ];
            channels.forEach(({ peaks, center }) => {
              context.strokeStyle = 'rgba(220,230,225,0.13)';
              context.beginPath();
              context.moveTo(0, center);
              context.lineTo(bounds.width, center);
              context.stroke();
              for (let x = 0; x < Math.ceil(bounds.width); x += 1) {
                const time = start + ((x + 0.5) / bounds.width) * span;
                if (time < 0 || time > duration) continue;
                const bin = Math.min(binCount - 1, Math.floor((time / duration) * binCount));
                const peak = peaks[bin];
                if (!peak) continue;
                const amplitude = waveHeight * 0.48;
                const top = center - peak[1] * amplitude;
                const bottom = center - peak[0] * amplitude;
                const spectralBin = bands?.low?.length
                  ? Math.min(bands.low.length - 1, Math.floor((bin / binCount) * bands.low.length))
                  : -1;
                const strengths = spectralBin >= 0
                  ? [bands.low[spectralBin], bands.mid[spectralBin], bands.high[spectralBin]]
                  : [];
                const strongestBand = strengths.indexOf(Math.max(0, ...strengths));
                context.fillStyle = strongestBand >= 0 ? BAND_COLORS[strongestBand] : color;
                context.globalAlpha = 0.88;
                context.fillRect(x, top, 1.2, Math.max(1, bottom - top));
              }
            });
          } else if (bands?.low?.length) {
            for (let x = 0; x < Math.ceil(bounds.width); x += 1) {
              const time = start + ((x + 0.5) / bounds.width) * span;
              if (time < 0 || time > duration) continue;
              const bin = Math.min(binCount - 1, Math.floor((time / duration) * binCount));
              const energyLevel = energy?.[bin] || 0;
              if (energyLevel > 0.78) {
                context.fillStyle = `rgba(231,177,83,${Math.min(0.11, energyLevel * 0.1)})`;
                context.fillRect(x, laneTop + 19, 1.2, laneHeight - 22);
              }
              for (let bandIndex = 0; bandIndex < 3; bandIndex += 1) {
                const amplitude = bands[['low', 'mid', 'high'][bandIndex]]?.[bin] || 0;
                const bandHeight = waveHeight * (bandIndex === 1 ? 0.96 : bandIndex === 0 ? 0.72 : 0.46) * amplitude;
                if (bandHeight < 0.6) continue;
                context.fillStyle = BAND_COLORS[bandIndex];
                context.globalAlpha = bandIndex === 1 ? 0.72 : 0.8;
                context.fillRect(x, centerY - bandHeight, 1.2, bandHeight * 2);
              }
            }
          }
          context.globalAlpha = 1;
        } else {
          context.strokeStyle = `${color}99`;
          context.beginPath();
          context.moveTo(0, centerY);
          context.lineTo(bounds.width, centerY);
          context.stroke();
          context.fillStyle = '#7e8985';
          context.font = '9px monospace';
          context.fillText(track.loading ? 'ANALYZING FULL-TRACK WAVEFORM…' : 'ANALYZED WAVEFORM APPEARS HERE', 12, centerY - 8);
        }

        (track.cues || []).forEach((cue, cueIndex) => {
          if (cue === null || cue < start || cue > end) return;
          const x = ((cue - start) / span) * bounds.width;
          context.fillStyle = '#ffd166';
          context.beginPath();
          context.moveTo(x, laneTop + 17);
          context.lineTo(x + 5, laneTop + 24);
          context.lineTo(x - 5, laneTop + 24);
          context.fill();
          context.fillText(String(cueIndex + 1), x + 6, laneTop + 25);
        });

        if (track.loop) {
          const loopStart = track.loop.start;
          const loopEnd = track.loop.end;
          if (loopEnd >= start && loopStart <= end) {
            const x1 = Math.max(0, ((loopStart - start) / span) * bounds.width);
            const x2 = Math.min(bounds.width, ((loopEnd - start) / span) * bounds.width);
            context.fillStyle = `${color}18`;
            context.fillRect(x1, laneTop + 18, x2 - x1, laneHeight - 18);
          }
        }

        (analysis?.sections || []).forEach((section) => {
          if (section.time < start || section.time > end) return;
          const x = ((section.time - start) / span) * bounds.width;
          context.fillStyle = 'rgba(220,230,225,0.52)';
          context.font = '7px monospace';
          context.fillText(section.label, x + 3, laneTop + laneHeight - 5);
        });

        if (duration > 0) {
          const playheadX = bounds.width / 2;
          context.beginPath();
          context.moveTo(playheadX, laneTop);
          context.lineTo(playheadX, laneTop + laneHeight);
          context.strokeStyle = '#f5f4e9';
          context.lineWidth = 1.5;
          context.stroke();
        }
        context.strokeStyle = 'rgba(181,193,188,0.14)';
        context.beginPath();
        context.moveTo(0, laneTop + laneHeight - 0.5);
        context.lineTo(bounds.width, laneTop + laneHeight - 0.5);
        context.stroke();
      });
      }
      animationFrame = requestAnimationFrame(render);
    };

    animationFrame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const handleWheel = (event) => {
      event.preventDefault();
      setZoom((current) => Math.min(16, Math.max(0.5, current * Math.exp(-event.deltaY / 500))));
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  const seekAtPointer = (event, drag) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    return Math.max(0, Math.min(
      drag.duration,
      drag.start + fraction * drag.span,
    ));
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || Math.abs(event.clientX - drag.startX) < 5) return;
    drag.moved = true;
    if (latestRef.current.gridEdit && !latestRef.current.gridLocked) return;
    latestRef.current.onSeek(drag.deck, seekAtPointer(event, drag));
  };

  const handlePointerUp = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const time = seekAtPointer(event, drag);
    if (latestRef.current.gridEdit && !latestRef.current.gridLocked) latestRef.current.onSetBeatOne(drag.deck, time);
    else if (!drag.moved) latestRef.current.onSeek(drag.deck, time);
    dragRef.current = null;
  };

  return (
    <div className="waveform-scope">
      <div className="waveform-zoom">
        <div className="waveform-legend"><i /> LOW <i /> MID <i /> HIGH <i /> BEAT <i /> BAR <i /> PHRASE</div>
        <span>BEATS IN VIEW <b>{Math.round(32 / zoom)}</b></span>
        <div>
          <button type="button" aria-label="Zoom waveform in" onClick={() => setZoom((value) => Math.min(16, value * 1.25))}><Plus /></button>
          <button type="button" aria-label="Reset waveform zoom" onClick={() => setZoom(1)}><RotateCw /></button>
          <button type="button" aria-label="Zoom waveform out" onClick={() => setZoom((value) => Math.max(0.5, value / 1.25))}><Minus /></button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        aria-label="Audio-analyzed Deck A and Deck B waveforms with synchronized beat and phrase grids"
        title={gridEdit && !gridLocked
          ? 'Grid Edit is on: click or scrub a deck lane to move Beat 1. Turn Grid Edit off to seek normally.'
          : 'Playhead remains centered as beat-matched audio scrolls. Click or drag a deck lane to seek; scroll to zoom.'}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const deck = event.clientY - bounds.top < bounds.height / 2 ? 'A' : 'B';
          const track = latestRef.current.tracks[deck];
          const duration = track.audioRef.current?.duration || track.analysis?.duration || 0;
          if (!duration) return;
          const position = track.audioRef.current?.currentTime || 0;
          const bpm = track.bpm;
          const beatSeconds = bpm > 0 ? 60 / bpm : 0.5;
          const span = (32 / zoomRef.current) * beatSeconds;
          const start = position - span / 2;
          dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            deck,
            start,
            span,
            duration,
            moved: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { dragRef.current = null; }}
        className="analyzed-waveform"
      />
    </div>
  );
}

export function TrackOverviewWaveform({ analysis, duration, position, color, onSeek, label }) {
  const canvasRef = useRef(null);
  const peaks = analysis?.peaks?.left;
  const peakData = useMemo(() => {
    const scalarPeaks = Array.isArray(peaks) && peaks.length && !Array.isArray(peaks[0]);
    const rangePeaks = Array.isArray(peaks) && Array.isArray(peaks[0]);
    return scalarPeaks
      ? peaks
      : rangePeaks
        ? peaks.map(([minimum, maximum]) => Math.max(Math.abs(minimum), Math.abs(maximum)))
        : [];
  }, [peaks]);
  const trackDuration = duration || analysis?.duration || 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(bounds.width * scale));
    const height = Math.max(1, Math.floor(bounds.height * scale));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    if (peakData.length) {
      const step = Math.max(1, Math.ceil(peakData.length / bounds.width));
      for (let x = 0; x < bounds.width; x += 1) {
        const peak = peakData[Math.min(peakData.length - 1, Math.floor(x / bounds.width * peakData.length))] || 0;
        const amplitude = Math.max(1, peak * (bounds.height - 5) * 0.46);
        context.globalAlpha = x / bounds.width < (trackDuration ? position / trackDuration : 0) ? 0.48 : 0.95;
        context.fillStyle = color;
        context.fillRect(x, (bounds.height - amplitude) / 2, Math.min(step, 2), amplitude);
      }
      context.globalAlpha = 1;
    } else {
      context.fillStyle = 'rgba(148,163,184,0.35)';
      context.fillRect(0, Math.floor(bounds.height / 2), bounds.width, 1);
    }
    if (trackDuration > 0) {
      const playhead = Math.min(bounds.width, position / trackDuration * bounds.width);
      context.strokeStyle = '#f8fafc';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(playhead, 0);
      context.lineTo(playhead, bounds.height);
      context.stroke();
    }
  }, [peakData, position, trackDuration, color]);

  const seekFromEvent = (event) => {
    if (!trackDuration) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(trackDuration, ((event.clientX - bounds.left) / bounds.width) * trackDuration)));
  };

  return (
    <canvas
      ref={canvasRef}
      className="track-overview-waveform"
      role="slider"
      aria-label={`${label} track overview waveform`}
      aria-valuemin="0"
      aria-valuemax={trackDuration}
      aria-valuenow={position}
      tabIndex={trackDuration ? 0 : -1}
      title={trackDuration ? `${label} · click or drag to seek` : 'Waveform appears after track analysis'}
      onPointerDown={(event) => {
        if (event.button !== 0 || !trackDuration) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        seekFromEvent(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons & 1) seekFromEvent(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          onSeek(Math.max(0, Math.min(trackDuration, position + (event.key === 'ArrowRight' ? 5 : -5))));
        }
      }}
    />
  );
}
