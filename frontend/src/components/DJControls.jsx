import { useEffect, useRef, useState } from 'react';
import { Disc } from 'lucide-react';

export function MixerKnob({ label, value, onChange, display, accent, ariaLabel, step = 0.1 }) {
  const dragRef = useRef(null);
  const angle = ((value / 100) * 270) - 135;
  const updateValue = (nextValue) => {
    onChange(Number(Math.min(100, Math.max(0, nextValue)).toFixed(1)));
  };
  const handleKeyDown = (event) => {
    const fineStep = event.shiftKey ? step : 1;
    let nextValue = value;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        nextValue += fineStep;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        nextValue -= fineStep;
        break;
      case 'PageUp':
        nextValue += 10;
        break;
      case 'PageDown':
        nextValue -= 10;
        break;
      case 'Home':
        nextValue = 0;
        break;
      case 'End':
        nextValue = 100;
        break;
      default:
        return;
    }
    event.preventDefault();
    updateValue(nextValue);
  };

  return (
    <label className="mixer-knob">
      <span>{label}</span>
      <span
        role="slider"
        aria-label={ariaLabel || `${label} control`}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={value}
        aria-valuetext={display}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          dragRef.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startValue: value,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (drag && drag.pointerId === event.pointerId) {
            updateValue(drag.startValue + (drag.startY - event.clientY) * 0.25);
          }
        }}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
        onKeyDown={handleKeyDown}
        className="mixer-knob-face"
        style={{ '--knob-angle': `${angle}deg`, '--knob-accent': accent }}
      >
        <span />
      </span>
      <output style={{ color: accent }}>{display}</output>
    </label>
  );
}

export function JogWheel({ deck, position, duration, playing, onSeek }) {
  const dragRef = useRef(null);
  return (
    <div
      className={`jog-wheel ${playing ? 'is-playing' : ''}`}
      role="slider"
      aria-label={`Deck ${deck} jog wheel position`}
      aria-valuemin="0"
      aria-valuemax={duration || 0}
      aria-valuenow={position}
      tabIndex={0}
      onPointerDown={(event) => {
        if (!duration || event.button !== 0) return;
        dragRef.current = { pointerId: event.pointerId, y: event.clientY, position };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (drag && drag.pointerId === event.pointerId && duration) {
          onSeek(Math.max(0, Math.min(duration, drag.position + (drag.y - event.clientY) * duration / 500)));
        }
      }}
      onPointerUp={() => { dragRef.current = null; }}
      onPointerCancel={() => { dragRef.current = null; }}
      style={{ '--jog-rotation': `${(position * 36) % 360}deg` }}
    >
      <span className="jog-markings" />
      <span className="jog-label"><Disc aria-hidden="true" /><b>DECK {deck}</b></span>
      <span className="jog-position">{formatJogTime(position)}</span>
    </div>
  );
}

function formatJogTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function readPeakDb(analyser, samples) {
  analyser.getFloatTimeDomainData(samples);
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
}

export function MasterLevelMeter({ graphsRef, clipped, clipRef, onClip, onReset }) {
  const [levels, setLevels] = useState([-60, -60]);
  const onClipRef = useRef(onClip);
  useEffect(() => {
    onClipRef.current = onClip;
  }, [onClip]);

  useEffect(() => {
    let animationFrame;
    let lastUpdate = 0;
    let samples = null;
    const update = (timestamp) => {
      if (timestamp - lastUpdate >= 50) {
        const graph = graphsRef.current.master;
        if (graph) {
          if (!samples) {
            samples = [new Float32Array(graph.leftAnalyser.fftSize), new Float32Array(graph.rightAnalyser.fftSize)];
          }
          const nextLevels = [
            readPeakDb(graph.leftAnalyser, samples[0]),
            readPeakDb(graph.rightAnalyser, samples[1]),
          ];
          setLevels((current) => nextLevels.some((level, index) => Math.abs(level - current[index]) >= 0.75)
            ? nextLevels
            : current);
          if (nextLevels.some((level) => level >= -0.5) && !clipRef.current) {
            clipRef.current = true;
            onClipRef.current();
          }
        }
        lastUpdate = timestamp;
      }
      animationFrame = requestAnimationFrame(update);
    };

    animationFrame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrame);
  }, [graphsRef, clipRef]);

  const levelWidth = (value) => `${Math.max(0, Math.min(100, ((value + 36) / 36) * 100))}%`;
  const severity = clipped || Math.max(...levels) >= -1 ? 'CLIPPING / OVERLOAD' : Math.max(...levels) >= -6 ? 'HIGH LEVEL' : 'SAFE LEVEL';
  return (
    <div className={`master-meter ${severity === 'CLIPPING / OVERLOAD' ? 'is-clipping' : ''}`} aria-label="Stereo master output level">
      <div className="master-meter-heading">
        <span>MASTER OUTPUT</span>
        <span className={`master-meter-status ${severity === 'SAFE LEVEL' ? '' : 'is-warning'}`}>{severity}</span>
        <button type="button" onClick={onReset} aria-label="Reset master clipping indicator">CLR</button>
      </div>
      {levels.map((level, index) => (
        <div className="meter-channel" key={index}>
          <span>{index === 0 ? 'L' : 'R'}</span>
          <div className="meter-track">
            <i style={{ width: levelWidth(level) }} />
            <b />
          </div>
          <output>{level <= -60 ? '−∞' : `${level.toFixed(0)} dB`}</output>
        </div>
      ))}
      <div className="meter-scale"><span>−36</span><span>−24</span><span>−18</span><span>−12</span><span>−6</span><span>−3</span><span>0 dB</span></div>
    </div>
  );
}

export function ChannelLevelMeter({ graphsRef, deck }) {
  const [level, setLevel] = useState(-60);

  useEffect(() => {
    let animationFrame;
    let lastUpdate = 0;
    let samples = null;
    const update = (timestamp) => {
      if (timestamp - lastUpdate >= 50) {
        const analyser = graphsRef.current[deck]?.channelMeter;
        if (analyser) {
          if (!samples) samples = new Float32Array(analyser.fftSize);
          const nextLevel = readPeakDb(analyser, samples);
          setLevel((current) => Math.abs(nextLevel - current) >= 0.75 ? nextLevel : current);
        }
        lastUpdate = timestamp;
      }
      animationFrame = requestAnimationFrame(update);
    };

    animationFrame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrame);
  }, [graphsRef, deck]);

  return (
    <div className="channel-meter" role="meter" aria-label={`Deck ${deck} audio level`} aria-valuemin="-60" aria-valuemax="0" aria-valuenow={Math.round(level)}>
      <span style={{ height: `${Math.max(0, Math.min(100, (level + 60) / 60 * 100))}%` }} />
    </div>
  );
}
