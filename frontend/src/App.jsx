import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Upload, Disc, Sliders, Sparkles, Headphones, RotateCcw, Link2, AudioLines, Cable, Minus, Plus, RotateCw, Search, ListMusic, Trash2, Repeat2, Keyboard } from 'lucide-react';
import AnalyzedWaveforms, { TrackOverviewWaveform } from './components/AnalyzedWaveforms.jsx';
import { ChannelLevelMeter, JogWheel, MasterLevelMeter } from './components/DJControls.jsx';

const createEq = () => ({ low: 50, mid: 50, high: 50 });
const TRACK_DATABASE = 'nexus-dj-library';
const TRACK_STORE = 'tracks';
const LOOP_LENGTHS = [1, 2, 4, 8];
const LOOP_DIVISIONS = [
  { beats: 0.25, label: '1/4' },
  { beats: 0.5, label: '1/2' },
  { beats: 1, label: '1' },
  { beats: 2, label: '2' },
  { beats: 4, label: '4' },
  { beats: 8, label: '8' },
];
const formatLoopLength = (beats) => {
  const division = LOOP_DIVISIONS.find((entry) => entry.beats === beats);
  return `${division?.label || beats} ${beats === 1 ? 'BEAT' : 'BEATS'}`;
};
const PHASE_ALIGNMENT_TOLERANCE = 0.005;
const FX_OPTIONS = [
  { id: 'echo', label: 'ECHO' },
  { id: 'reverb', label: 'REVERB' },
  { id: 'filter', label: 'FILTER SWEEP' },
  { id: 'flanger', label: 'FLANGER' },
  { id: 'chorus', label: 'CHORUS' },
  { id: 'phaser', label: 'PHASER' },
  { id: 'tremolo', label: 'TREMOLO' },
  { id: 'drive', label: 'OVERDRIVE' },
  { id: 'crush', label: 'BIT CRUSH' },
  { id: 'gate', label: 'BEAT GATE' },
];
const TIME_DIVISIONS = [
  { label: '1/32', beats: 1 / 32 },
  { label: '1/16', beats: 1 / 16 },
  { label: '1/8', beats: 1 / 8 },
  { label: '1/4', beats: 1 / 4 },
  { label: '1/2', beats: 1 / 2 },
  { label: '3/4', beats: 3 / 4 },
  { label: '1 beat', beats: 1 },
  { label: '2 beats', beats: 2 },
  { label: '4 beats', beats: 4 },
];
const MIDI_ACTIONS = [
  { id: 'playA', label: 'Deck A · Play / pause', kind: 'trigger' },
  { id: 'playB', label: 'Deck B · Play / pause', kind: 'trigger' },
  { id: 'syncA', label: 'Deck A · Sync to B', kind: 'trigger' },
  { id: 'syncB', label: 'Deck B · Sync to A', kind: 'trigger' },
  { id: 'crossfader', label: 'Master · Crossfader', kind: 'value' },
  { id: 'lowA', label: 'Deck A · Low EQ', kind: 'value' },
  { id: 'midA', label: 'Deck A · Mid EQ', kind: 'value' },
  { id: 'highA', label: 'Deck A · High EQ', kind: 'value' },
  { id: 'fxA', label: 'Deck A · FX depth', kind: 'value' },
  { id: 'lowB', label: 'Deck B · Low EQ', kind: 'value' },
  { id: 'midB', label: 'Deck B · Mid EQ', kind: 'value' },
  { id: 'highB', label: 'Deck B · High EQ', kind: 'value' },
  { id: 'fxB', label: 'Deck B · FX depth', kind: 'value' },
  ...[1, 2, 3, 4].flatMap((index) => [
    { id: `cueA${index}`, label: `Deck A · Hot cue ${index}`, kind: 'trigger' },
    { id: `cueB${index}`, label: `Deck B · Hot cue ${index}`, kind: 'trigger' },
  ]),
];

function hasFullTrackWaveform(analysis) {
  const peakCount = analysis?.peaks?.left?.length;
  const hasPcmPeaks = peakCount > 0
    && Array.isArray(analysis.peaks.right)
    && analysis.peaks.right.length === peakCount
    && analysis.peaks.left.every((peak) => Array.isArray(peak) && peak.length === 2);
  const binCount = analysis?.bands?.low?.length || 0;
  const hasSpectralBands = binCount > 0
    && ['mid', 'high'].every((band) => Array.isArray(analysis.bands[band]) && analysis.bands[band].length === binCount)
    && Array.isArray(analysis.energy)
    && analysis.energy.length === binCount;
  return Number.isFinite(analysis?.duration)
    && analysis.duration > 0
    && (hasPcmPeaks || hasSpectralBands);
}

function getCamelotCompatibility(firstKey, secondKey) {
  const first = /^(\d{1,2})([AB])$/i.exec(String(firstKey || '').trim());
  const second = /^(\d{1,2})([AB])$/i.exec(String(secondKey || '').trim());
  if (!first || !second) {
    return firstKey && secondKey && String(firstKey).toLowerCase() === String(secondKey).toLowerCase()
      ? { score: 30, label: 'SAME KEY' }
      : { score: 14, label: 'KEY UNKNOWN' };
  }
  const firstNumber = Number(first[1]);
  const secondNumber = Number(second[1]);
  if (firstNumber < 1 || firstNumber > 12 || secondNumber < 1 || secondNumber > 12) {
    return { score: 14, label: 'KEY UNKNOWN' };
  }
  const firstMode = first[2].toUpperCase();
  const secondMode = second[2].toUpperCase();
  if (firstNumber === secondNumber && firstMode === secondMode) return { score: 30, label: 'SAME KEY' };
  if (firstNumber === secondNumber && firstMode !== secondMode) return { score: 26, label: 'RELATIVE KEY' };
  const distance = Math.abs(firstNumber - secondNumber);
  if (firstMode === secondMode && Math.min(distance, 12 - distance) === 1) {
    return { score: 24, label: 'ADJACENT KEY' };
  }
  return { score: 0, label: 'KEY SHIFT' };
}

function scoreTransitionCandidate(track, sourceBpm, sourceKey, sourceEnergy) {
  const targetBpm = Number(track.bpm);
  if (!(targetBpm > 0) || !(sourceBpm > 0)) return null;
  const ratio = targetBpm / sourceBpm;
  const beatRatios = [0.5, 1, 2];
  const closestRatio = beatRatios.reduce((closest, candidate) => (
    Math.abs(ratio - candidate) / candidate < Math.abs(ratio - closest) / closest ? candidate : closest
  ), beatRatios[0]);
  const tempoDeviation = Math.abs(ratio - closestRatio) / closestRatio * 100;
  const tempoScore = 45 * (1 - Math.min(tempoDeviation / 8, 1));
  const keyMatch = getCamelotCompatibility(sourceKey, track.key);
  const hasEnergyData = sourceEnergy !== null && sourceEnergy !== undefined && sourceEnergy !== ''
    && track.energy !== null && track.energy !== undefined && track.energy !== '';
  const energyDifference = hasEnergyData
    && Number.isFinite(Number(sourceEnergy))
    && Number.isFinite(Number(track.energy))
    ? Math.abs(Number(sourceEnergy) - Number(track.energy))
    : null;
  const energyScore = energyDifference === null ? 13 : 25 * (1 - energyDifference / 9);
  const score = tempoScore + keyMatch.score + energyScore;
  const tempoLabel = closestRatio === 1
    ? `${tempoDeviation.toFixed(1)}% tempo shift`
    : `${closestRatio === 2 ? '2×' : '½×'} beat match · ${tempoDeviation.toFixed(1)}% trim`;
  const energyLabel = energyDifference === null ? 'energy not analyzed' : `${energyDifference} energy difference`;
  return {
    score: Math.round(score),
    targetBpm,
    keyMatch: keyMatch.label,
    tempoLabel,
    rationale: `${tempoLabel} · ${keyMatch.label.toLowerCase()} · ${energyLabel}`,
  };
}

async function createLocalPcmWaveform(file, audioContextRef) {
  const Context = window.AudioContext;
  if (!Context) throw new Error('This browser does not support audio waveform decoding.');
  const context = audioContextRef.current || (audioContextRef.current = new Context());
  const audioBuffer = await context.decodeAudioData(await file.arrayBuffer());
  const binCount = Math.min(2400, audioBuffer.length);
  if (binCount < 1) throw new Error('The decoded audio file contains no samples.');
  const channels = [
    new Float32Array(audioBuffer.getChannelData(0)),
    new Float32Array(audioBuffer.getChannelData(Math.min(1, audioBuffer.numberOfChannels - 1))),
  ];
  const worker = new Worker(new URL('./workers/waveform.worker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      worker.terminate();
      resolve(data);
    };
    worker.onerror = (error) => {
      worker.terminate();
      reject(new Error(error.message || 'The waveform worker could not analyze this track.'));
    };
    worker.postMessage(
      { channels, duration: audioBuffer.duration, bins: binCount },
      channels.map((channel) => channel.buffer),
    );
  });
}

function readSavedMidiMappings() {
  try {
    const stored = localStorage.getItem('nexus-midi-mappings');
    if (!stored) return {};
    const mappings = JSON.parse(stored);
    if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) {
      throw new Error('Saved MIDI mappings have an invalid format.');
    }
    return mappings;
  } catch (error) {
    console.error('Could not load saved MIDI mappings:', error);
    return {};
  }
}

function readSavedQueue() {
  try {
    const stored = localStorage.getItem('nexus-dj-queue');
    if (!stored) return [];
    const queue = JSON.parse(stored);
    if (!Array.isArray(queue) || queue.some((id) => typeof id !== 'string')) {
      throw new Error('Saved queue has an invalid format.');
    }
    return queue;
  } catch (error) {
    console.error('Could not load the saved queue:', error);
    return [];
  }
}

function openTrackDatabase() {
  if (!window.indexedDB) {
    return Promise.reject(new Error('This browser does not support local track storage.'));
  }
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(TRACK_DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(TRACK_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the track library.'));
  });
}

async function saveLibraryTrack(track) {
  const database = await openTrackDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(TRACK_STORE, 'readwrite');
    transaction.objectStore(TRACK_STORE).put(track);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Could not save this track to the library.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Saving this track to the library was cancelled.'));
    };
  });
}

async function readLibraryTracks() {
  const database = await openTrackDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(TRACK_STORE, 'readonly');
    const request = transaction.objectStore(TRACK_STORE).getAll();
    request.onsuccess = () => {
      const tracks = request.result.sort((first, second) => first.name.localeCompare(second.name));
      database.close();
      resolve(tracks);
    };
    request.onerror = () => {
      database.close();
      reject(request.error || new Error('Could not read the track library.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Reading the track library was cancelled.'));
    };
  });
}

async function readLibraryTrack(id) {
  const database = await openTrackDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(TRACK_STORE, 'readonly');
    const request = transaction.objectStore(TRACK_STORE).get(id);
    request.onsuccess = () => {
      database.close();
      resolve(request.result);
    };
    request.onerror = () => {
      database.close();
      reject(request.error || new Error('Could not load this library track.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Loading this library track was cancelled.'));
    };
  });
}

async function analyzeTrackFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('http://localhost:8000/analyze', {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) throw new Error(`Analysis service returned HTTP ${response.status}.`);
  const data = await response.json();
  if (data.status !== 'success' || !(Number(data.bpm) > 0)) {
    throw new Error(data.detail || 'The analysis service did not return valid track metadata.');
  }
  return data;
}

async function deleteLibraryTrack(id) {
  const database = await openTrackDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(TRACK_STORE, 'readwrite');
    transaction.objectStore(TRACK_STORE).delete(id);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Could not remove this library track.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Removing this library track was cancelled.'));
    };
  });
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function makeBeatGrid(firstBeatTime, bpm, duration) {
  const interval = 60 / bpm;
  if (!(interval > 0) || !Number.isFinite(duration) || duration <= 0) return [];
  const firstIndex = Math.ceil(-firstBeatTime / interval);
  const lastIndex = Math.floor((duration - firstBeatTime) / interval);
  return Array.from(
    { length: Math.max(0, lastIndex - firstIndex + 1) },
    (_, offset) => Number((firstBeatTime + (firstIndex + offset) * interval).toFixed(4)),
  );
}

function getBeatPhase(time, anchor, bpm) {
  if (!(bpm > 0)) return 0;
  const beatPosition = ((time - anchor) * bpm) / 60;
  return ((beatPosition % 4) + 4) % 4;
}

function getBarPhaseDifference(phaseA, phaseB) {
  const difference = phaseB - phaseA;
  return ((difference + 2) % 4 + 4) % 4 - 2;
}

function makeDriveCurve(amount) {
  const curve = new Float32Array(2048);
  const drive = 1 + amount * 24;
  for (let index = 0; index < curve.length; index += 1) {
    const x = (index * 2) / (curve.length - 1) - 1;
    curve[index] = ((1 + drive) * x) / (1 + drive * Math.abs(x));
  }
  return curve;
}

function createFxBranch(context, type) {
  const nodes = [];
  const createNode = (create) => {
    const node = create();
    nodes.push(node);
    return node;
  };
  const input = createNode(() => context.createGain());
  const output = createNode(() => context.createGain());
  output.gain.value = 0;
  let delay = null;
  let feedback = null;
  let filter = null;
  let lfo = null;
  let lfoDepth = null;
  let shaper = null;
  let started = false;

  if (type === 'echo') {
    delay = createNode(() => context.createDelay(5));
    feedback = createNode(() => context.createGain());
    input.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(output);
  } else if (type === 'reverb') {
    const convolver = createNode(() => context.createConvolver());
    delay = createNode(() => context.createDelay(5));
    const impulseLength = context.sampleRate * 2.5;
    const impulse = context.createBuffer(2, impulseLength, context.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const samples = impulse.getChannelData(channel);
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = (Math.random() * 2 - 1) * (1 - index / samples.length) ** 2.5;
      }
    }
    convolver.buffer = impulse;
    input.connect(delay);
    delay.connect(convolver);
    convolver.connect(output);
  } else if (type === 'filter') {
    filter = createNode(() => context.createBiquadFilter());
    filter.type = 'lowpass';
    filter.frequency.value = 18000;
    lfo = createNode(() => context.createOscillator());
    lfoDepth = createNode(() => context.createGain());
    lfo.connect(lfoDepth);
    lfoDepth.connect(filter.frequency);
    input.connect(filter);
    filter.connect(output);
  } else if (type === 'flanger' || type === 'chorus') {
    delay = createNode(() => context.createDelay(1));
    delay.delayTime.value = type === 'flanger' ? 0.004 : 0.018;
    lfo = createNode(() => context.createOscillator());
    lfoDepth = createNode(() => context.createGain());
    lfo.connect(lfoDepth);
    lfoDepth.connect(delay.delayTime);
    input.connect(delay);
    delay.connect(output);
  } else if (type === 'phaser') {
    const stages = Array.from({ length: 4 }, () => {
      const stage = createNode(() => context.createBiquadFilter());
      stage.type = 'allpass';
      return stage;
    });
    stages.forEach((stage, index) => {
      if (index === 0) input.connect(stage);
      else stages[index - 1].connect(stage);
    });
    stages[stages.length - 1].connect(output);
    lfo = createNode(() => context.createOscillator());
    lfoDepth = createNode(() => context.createGain());
    lfo.frequency.value = 0.4;
    lfo.connect(lfoDepth);
    stages.forEach((stage) => lfoDepth.connect(stage.frequency));
  } else if (type === 'tremolo' || type === 'gate') {
    const amplitude = createNode(() => context.createGain());
    amplitude.gain.value = 0.55;
    lfo = createNode(() => context.createOscillator());
    lfoDepth = createNode(() => context.createGain());
    lfo.connect(lfoDepth);
    lfoDepth.connect(amplitude.gain);
    input.connect(amplitude);
    amplitude.connect(output);
  } else if (type === 'drive' || type === 'crush') {
    shaper = createNode(() => context.createWaveShaper());
    const amplitude = createNode(() => context.createGain());
    amplitude.gain.value = 0.65;
    lfo = createNode(() => context.createOscillator());
    lfoDepth = createNode(() => context.createGain());
    lfo.connect(lfoDepth);
    lfoDepth.connect(amplitude.gain);
    shaper.oversample = '4x';
    input.connect(shaper);
    shaper.connect(amplitude);
    amplitude.connect(output);
  }

  return {
    input,
    output,
    delay,
    feedback,
    filter,
    lfo,
    lfoDepth,
    shaper,
    start() {
      if (lfo && !started) {
        lfo.start();
        started = true;
      }
    },
    dispose() {
      if (started) lfo.stop();
      nodes.forEach((node) => node.disconnect());
    },
  };
}

function createMasterAudioGraph(context, volume) {
  const input = context.createGain();
  const dry = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const gain = context.createGain();
  const analyser = context.createAnalyser();
  const splitter = context.createChannelSplitter(2);
  const leftAnalyser = context.createAnalyser();
  const rightAnalyser = context.createAnalyser();
  const cueDestination = context.createMediaStreamDestination();
  compressor.threshold.value = -2;
  compressor.knee.value = 0;
  compressor.ratio.value = 16;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.12;
  dry.gain.value = 1;
  gain.gain.value = Math.min(1, Math.max(0, volume / 100));
  analyser.fftSize = 2048;
  leftAnalyser.fftSize = 1024;
  rightAnalyser.fftSize = 1024;
  input.connect(dry);
  dry.connect(compressor);
  compressor.connect(gain);
  gain.connect(analyser);
  analyser.connect(splitter);
  splitter.connect(leftAnalyser, 0);
  splitter.connect(rightAnalyser, 1);
  analyser.connect(context.destination);

  return {
    context,
    input,
    dry,
    compressor,
    gain,
    analyser,
    leftAnalyser,
    rightAnalyser,
    cueDestination,
    effectInput: input,
    effectOutput: compressor,
    effects: {},
  };
}

function createDeckAudioGraph(audio, context, masterGraph) {
  const source = context.createMediaElementSource(audio);
  const inputGain = context.createGain();
  const low = context.createBiquadFilter();
  const mid = context.createBiquadFilter();
  const high = context.createBiquadFilter();
  const channelFilter = context.createBiquadFilter();
  const analyser = context.createAnalyser();
  const channelFader = context.createGain();
  const channelMeter = context.createAnalyser();
  const crossfaderGain = context.createGain();
  const cueSend = context.createGain();
  low.type = 'lowshelf';
  low.frequency.value = 250;
  mid.type = 'peaking';
  mid.frequency.value = 1000;
  mid.Q.value = 0.8;
  high.type = 'highshelf';
  high.frequency.value = 4000;
  channelFilter.type = 'lowpass';
  channelFilter.frequency.value = 18000;
  analyser.fftSize = 1024;
  channelMeter.fftSize = 1024;
  channelFader.gain.value = 1;
  source.connect(inputGain);
  inputGain.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(channelFilter);
  channelFilter.connect(analyser);
  const dry = context.createGain();
  analyser.connect(dry);
  dry.connect(channelFader);
  const effects = {};
  channelFader.connect(channelMeter);
  channelMeter.connect(crossfaderGain);
  crossfaderGain.connect(masterGraph.input);
  analyser.connect(cueSend);
  cueSend.gain.value = 0;
  cueSend.connect(masterGraph.cueDestination);
  return {
    context,
    source,
    inputGain,
    low,
    mid,
    high,
    channelFilter,
    analyser,
    channelFader,
    channelMeter,
    crossfaderGain,
    cueSend,
    effectInput: analyser,
    effectOutput: channelFader,
    effects,
  };
}

function applyEffectSettings(graph, fx, fxEnabled, fxType, division, bpm, targetEnabled) {
  const now = graph.context.currentTime;
  const beatSeconds = bpm > 0 ? 60 / bpm : 0.5;
  const delaySeconds = Math.min(4.8, Math.max(0.001, beatSeconds * division));
  const modulationRate = Math.min(8, Math.max(0.1, 1 / (beatSeconds * division * 2)));
  const selected = targetEnabled && fxEnabled && fx > 0;
  const current = Object.entries(graph.effects)[0];
  if (current && (!selected || current[0] !== fxType)) {
    const [type, branch] = current;
    graph.effectInput.disconnect(branch.input);
    branch.output.disconnect(graph.effectOutput);
    branch.dispose();
    delete graph.effects[type];
  }
  if (!selected) return;

  let branch = graph.effects[fxType];
  if (!branch) {
    branch = createFxBranch(graph.context, fxType);
    graph.effectInput.connect(branch.input);
    branch.output.connect(graph.effectOutput);
    branch.start();
    graph.effects[fxType] = branch;
  }
  branch.output.gain.setTargetAtTime((fx / 100) * 0.72, now, 0.025);
  if (branch.delay) {
    branch.delay.delayTime.setTargetAtTime(
      fxType === 'echo' ? delaySeconds : fxType === 'flanger' ? 0.004 : 0.018,
      now,
      0.025,
    );
  }
  if (branch.feedback) {
    branch.feedback.gain.setTargetAtTime(Math.min(0.78, 0.12 + (fx / 100) * 0.62), now, 0.025);
  }
  if (branch.filter) {
    branch.filter.frequency.setTargetAtTime(18000 * (300 / 18000) ** (fx / 100), now, 0.025);
  }
  if (branch.lfo) {
    branch.lfo.frequency.setTargetAtTime(modulationRate, now, 0.025);
  }
  if (branch.lfoDepth) {
    const depth = fxType === 'phaser' ? fx * 12 : fxType === 'flanger' ? (fx / 100) * 0.002 : fxType === 'chorus' ? (fx / 100) * 0.012 : fxType === 'filter' ? fx * 80 : fxType === 'drive' || fxType === 'crush' ? (fx / 100) * 0.35 : (fx / 100) * 0.45;
    branch.lfoDepth.gain.setTargetAtTime(depth, now, 0.025);
  }
  if (branch.shaper) branch.shaper.curve = makeDriveCurve(fx / 100);
}

function applyDeckAudioSettings(graph, eq, fx, fxEnabled, fxType, division, bpm, gain, volume, filterValue, fxTargeted) {
  const now = graph.context.currentTime;
  graph.low.gain.setTargetAtTime((eq.low - 50) * 0.24, now, 0.025);
  graph.mid.gain.setTargetAtTime((eq.mid - 50) * 0.24, now, 0.025);
  graph.high.gain.setTargetAtTime((eq.high - 50) * 0.24, now, 0.025);
  graph.inputGain.gain.setTargetAtTime(Math.min(2, Math.max(0, gain / 50)), now, 0.025);
  graph.channelFader.gain.setTargetAtTime(Math.min(1, Math.max(0, volume / 100)), now, 0.025);
  const filterFrequency = 250 * (18000 / 250) ** (filterValue / 100);
  graph.channelFilter.frequency.setTargetAtTime(filterFrequency, now, 0.025);
  applyEffectSettings(graph, fx, fxEnabled, fxType, division, bpm, fxTargeted);
}

function setCrossfaderGains(graphs, crossfader) {
  const normalized = Math.min(1, Math.max(0, crossfader / 100));
  ['A', 'B'].forEach((deck, index) => {
    const graph = graphs[deck];
    if (!graph) return;
    const gain = index === 0 ? Math.cos(normalized * Math.PI / 2) : Math.sin(normalized * Math.PI / 2);
    graph.crossfaderGain.gain.setTargetAtTime(gain, graph.context.currentTime, 0.015);
  });
}

export function LiveWaveforms({ graphsRef, audioARef, audioBRef, bpmA, bpmB }) {
  const canvasRef = useRef(null);
  const latestRef = useRef({ graphsRef, audioARef, audioBRef, bpmA, bpmB });
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  const dragRef = useRef(null);

  useEffect(() => {
    latestRef.current = { graphsRef, audioARef, audioBRef, bpmA, bpmB };
  }, [graphsRef, audioARef, audioBRef, bpmA, bpmB]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    const lanes = { A: new Float32Array(375), B: new Float32Array(375) };
    let lastSampleAt = 0;
    let animationFrame;

    const render = (timestamp) => {
      const { graphsRef: currentGraphs, audioARef: currentAudioA, audioBRef: currentAudioB, bpmA: tempoA, bpmB: tempoB } = latestRef.current;
      const bounds = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(bounds.width * scale));
      const height = Math.max(1, Math.floor(bounds.height * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.setTransform(scale, 0, 0, scale, 0, 0);
      const cssWidth = bounds.width;
      const cssHeight = bounds.height;
      context.fillStyle = '#090b12';
      context.fillRect(0, 0, cssWidth, cssHeight);

      if (timestamp - lastSampleAt > 32) {
        ['A', 'B'].forEach((deck) => {
          const analyser = currentGraphs.current[deck]?.analyser;
          let amplitude = 0;
          if (analyser) {
            const samples = new Uint8Array(analyser.fftSize);
            analyser.getByteTimeDomainData(samples);
            amplitude = samples.reduce((sum, value) => sum + Math.abs(value - 128), 0) / samples.length / 128;
          }
          const lane = lanes[deck];
          lane.copyWithin(0, 1);
          lane[lane.length - 1] = amplitude;
        });
        lastSampleAt = timestamp;
      }

      const laneHeight = cssHeight / 2;
      const spanSeconds = 6 / zoomRef.current;
      ['A', 'B'].forEach((deck, laneIndex) => {
        const top = laneIndex * laneHeight;
        const audio = (deck === 'A' ? currentAudioA : currentAudioB).current;
        const bpm = deck === 'A' ? tempoA : tempoB;
        const color = deck === 'A' ? '#c8ed68' : '#87918e';
        context.fillStyle = '#111516';
        context.fillRect(0, top, cssWidth, laneHeight);
        context.strokeStyle = 'rgba(148,163,184,0.13)';
        context.beginPath();
        context.moveTo(0, top + laneHeight / 2);
        context.lineTo(cssWidth, top + laneHeight / 2);
        context.stroke();

        const beatSeconds = bpm > 0 ? 60 / bpm : 0;
        if (audio && beatSeconds > 0) {
          const position = audio.currentTime;
          const phase = position % beatSeconds;
          for (let age = phase; age < spanSeconds; age += beatSeconds) {
            const x = cssWidth - (age / spanSeconds) * cssWidth;
            context.strokeStyle = age < 0.035 ? `${color}aa` : 'rgba(148,163,184,0.16)';
            context.beginPath();
            context.moveTo(x, top + 5);
            context.lineTo(x, top + laneHeight - 5);
            context.stroke();
          }
        }

        context.beginPath();
        const visibleSamples = Math.min(lanes[deck].length, Math.max(2, Math.round(spanSeconds * 1000 / 32)));
        const sampleOffset = lanes[deck].length - visibleSamples;
        for (let index = 0; index < visibleSamples; index += 1) {
          const amplitude = lanes[deck][sampleOffset + index];
          const x = (index / (visibleSamples - 1)) * cssWidth;
          const halfHeight = laneHeight * 0.38 * amplitude;
          context.moveTo(x, top + laneHeight / 2 - halfHeight);
          context.lineTo(x, top + laneHeight / 2 + halfHeight);
        }
        context.strokeStyle = color;
        context.lineWidth = 1.5;
        context.shadowBlur = 8;
        context.shadowColor = color;
        context.stroke();
        context.shadowBlur = 0;

        context.fillStyle = color;
        context.font = 'bold 10px monospace';
        context.fillText(`DECK ${deck}  ${bpm > 0 ? `${bpm.toFixed(1)} BPM` : 'LOAD TRACK FOR BEAT GRID'}`, 10, top + 15);
      });
      context.strokeStyle = '#f8fafc';
      context.globalAlpha = 0.6;
      context.beginPath();
      context.moveTo(cssWidth - 1, 0);
      context.lineTo(cssWidth - 1, cssHeight);
      context.stroke();
      context.globalAlpha = 1;
      animationFrame = requestAnimationFrame(render);
    };

    animationFrame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  const updateZoomFromDrag = (event) => {
    if (!dragRef.current) return;
    const delta = event.clientX - dragRef.current.x;
    setZoom(Math.min(8, Math.max(0.5, dragRef.current.zoom * Math.exp(delta / 180))));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const handleWheel = (event) => {
      event.preventDefault();
      setZoom((current) => Math.min(8, Math.max(0.5, current * Math.exp(-event.deltaY / 500))));
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  return (
    <div className="waveform-scope">
      <div className="waveform-zoom">
        <span>HORIZONTAL STRETCH <b>{zoom.toFixed(1)}×</b></span>
        <div>
          <button type="button" aria-label="Stretch waveform in" title="Stretch waveform in" onClick={() => setZoom((value) => Math.min(8, value * 1.25))}>
            <Plus />
          </button>
          <button type="button" aria-label="Reset waveform stretch" title="Reset waveform stretch" onClick={() => setZoom(1)}>
            <RotateCw />
          </button>
          <button type="button" aria-label="Stretch waveform out" title="Stretch waveform out" onClick={() => setZoom((value) => Math.max(0.5, value / 1.25))}>
            <Minus />
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        aria-label="Live deck waveforms and estimated beat grids"
        title={`Drag horizontally or scroll to stretch waveform · ${zoom.toFixed(1)}×`}
        onPointerDown={(event) => {
          dragRef.current = { x: event.clientX, zoom };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={updateZoomFromDrag}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
        className="waveform-canvas block h-36 w-full rounded-lg border border-slate-800"
      />
    </div>
  );
}

function LoopLengthDial({ deck, beats, onChange, accent, disabled }) {
  const dragRef = useRef(null);
  const index = LOOP_DIVISIONS.findIndex((division) => division.beats === beats);
  const angle = ((index / (LOOP_DIVISIONS.length - 1)) * 270) - 135;
  const display = `${LOOP_DIVISIONS[index].label} ${beats === 1 ? 'BEAT' : 'BEATS'}`;
  const updateIndex = (nextIndex) => {
    const boundedIndex = Math.max(0, Math.min(LOOP_DIVISIONS.length - 1, nextIndex));
    onChange(LOOP_DIVISIONS[boundedIndex].beats);
  };

  return (
    <div className="loop-length-control">
      <label className="mixer-knob loop-size-dial">
        <span>LOOP SIZE</span>
        <span
          role="slider"
          aria-label={`Deck ${deck} quantized loop size`}
          aria-valuemin="0"
          aria-valuemax={LOOP_DIVISIONS.length - 1}
          aria-valuenow={index}
          aria-valuetext={display}
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startIndex: index };
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (drag && drag.pointerId === event.pointerId) {
              updateIndex(drag.startIndex + Math.round((drag.startY - event.clientY) / 18));
            }
          }}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
          onKeyDown={(event) => {
            const keySteps = {
              ArrowUp: 1,
              ArrowRight: 1,
              ArrowDown: -1,
              ArrowLeft: -1,
              PageUp: 2,
              PageDown: -2,
              Home: -index,
              End: LOOP_DIVISIONS.length - 1 - index,
            };
            if (keySteps[event.key] === undefined || disabled) return;
            event.preventDefault();
            updateIndex(index + keySteps[event.key]);
          }}
          className="mixer-knob-face"
          style={{ '--knob-angle': `${angle}deg`, '--knob-accent': accent }}
        >
          <span />
        </span>
        <output style={{ color: accent }}>{display}</output>
      </label>
      <div className="loop-dial-range" aria-hidden="true"><span>TIGHT</span><span>LOOSE</span></div>
    </div>
  );
}

function BeatLoopControls({ deck, loop, selectedBeats, onLengthChange, onToggle, status, disabled }) {
  const visibleStatus = status.includes(`DECK ${deck}`);
  return (
    <section className="loop-strip" aria-label={`Deck ${deck} beat loops`}>
      <div className="loop-heading">
        <span><Repeat2 aria-hidden="true" /> BEAT LOOP</span>
        {loop && <span className="loop-active">{formatLoopLength(loop.beats)} · GRID LOCKED</span>}
      </div>
      <div className="loop-controls">
        <LoopLengthDial
          deck={deck}
          beats={selectedBeats}
          onChange={(beats) => onLengthChange(deck, beats)}
          accent={deck === 'A' ? '#5ad9c4' : '#b79aff'}
          disabled={disabled}
        />
        <div className="loop-buttons">
          {LOOP_LENGTHS.map((beats) => (
            <button
              key={beats}
              type="button"
              aria-pressed={loop?.beats === beats}
              disabled={disabled}
              onClick={() => onToggle(deck, beats)}
              className={loop?.beats === beats ? 'is-active' : ''}
            >
              {beats}
            </button>
          ))}
          <button
            type="button"
            aria-label={`Exit deck ${deck} loop`}
            disabled={!loop}
            onClick={() => onToggle(deck, loop.beats)}
            className="loop-exit"
          >
            EXIT
          </button>
        </div>
      </div>
      {visibleStatus && <p role="status">{status}</p>}
    </section>
  );
}

function MixerKnob({ label, value, onChange, display, accent, ariaLabel, step = 0.1 }) {
  const dragRef = useRef(null);
  const angle = ((value / 100) * 270) - 135;
  const updateValue = (nextValue) => {
    const clampedValue = Math.min(100, Math.max(0, nextValue));
    onChange(Number(clampedValue.toFixed(1)));
  };
  const handlePointerDown = (event) => {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startValue: value,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    updateValue(drag.startValue + (drag.startY - event.clientY) * 0.25);
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
    <label className="flex min-w-0 flex-col items-center gap-1.5">
      <span className="text-[9px] font-black tracking-[0.16em] text-slate-400">{label}</span>
      <span
        role="slider"
        aria-label={ariaLabel || `${label} control`}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={value}
        aria-valuetext={display}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
        onKeyDown={handleKeyDown}
        className="relative block h-14 w-14 touch-none cursor-ns-resize rounded-full border border-slate-600/80 shadow-[0_5px_14px_rgba(0,0,0,0.45)] outline-none focus-visible:ring-2 focus-visible:ring-lime-300"
        style={{ background: 'radial-gradient(circle at 35% 28%, #343947 0%, #1a1d27 48%, #0b0d13 100%)' }}
      >
        <span className="absolute inset-[5px] rounded-full border border-white/5" />
        <span
          className="absolute inset-0 rounded-full"
          style={{ transform: `rotate(${angle}deg)` }}
        >
          <span
            className="absolute left-1/2 top-[5px] h-2.5 w-0.5 -translate-x-1/2 rounded-full"
            style={{ backgroundColor: accent, boxShadow: `0 0 8px ${accent}` }}
          />
        </span>
      </span>
      <output className="text-[10px] font-bold tabular-nums" style={{ color: accent }}>
        {display}
      </output>
    </label>
  );
}

export default function App() {
  const [deckA, setDeckA] = useState({ name: 'NO TRACK LOADED', bpm: '--', key: '--', energy: '--', analysis: null, artist: 'LOCAL FILE', loading: false, audioUrl: null, libraryTrackId: null, error: null });
  const [deckB, setDeckB] = useState({ name: 'NO TRACK LOADED', bpm: '--', key: '--', energy: '--', analysis: null, artist: 'LOCAL FILE', loading: false, audioUrl: null, libraryTrackId: null, error: null });
  const [isPlayingA, setIsPlayingA] = useState(false);
  const [isPlayingB, setIsPlayingB] = useState(false);
  const [playbackRateA, setPlaybackRateA] = useState(1);
  const [playbackRateB, setPlaybackRateB] = useState(1);
  const [pitchRangeA, setPitchRangeA] = useState(8);
  const [pitchRangeB, setPitchRangeB] = useState(8);
  const [crossfader, setCrossfader] = useState(50);
  const [masterVolume, setMasterVolume] = useState(80);
  const [channelGainA, setChannelGainA] = useState(50);
  const [channelGainB, setChannelGainB] = useState(50);
  const [channelVolumeA, setChannelVolumeA] = useState(100);
  const [channelVolumeB, setChannelVolumeB] = useState(100);
  const [channelFilterA, setChannelFilterA] = useState(100);
  const [channelFilterB, setChannelFilterB] = useState(100);
  const [cueA, setCueA] = useState(false);
  const [cueB, setCueB] = useState(false);
  const [cueOutput, setCueOutput] = useState(null);
  const [cueOutputStatus, setCueOutputStatus] = useState('SELECT A HEADPHONE OUTPUT TO ENABLE CUE MONITORING');
  const [masterClipped, setMasterClipped] = useState(false);
  const [activeDeck, setActiveDeck] = useState('A');
  const [eqA, setEqA] = useState(createEq);
  const [eqB, setEqB] = useState(createEq);
  const [fxA, setFxA] = useState(0);
  const [fxB, setFxB] = useState(0);
  const [fxEnabledA, setFxEnabledA] = useState(false);
  const [fxEnabledB, setFxEnabledB] = useState(false);
  const [fxTypeA, setFxTypeA] = useState('echo');
  const [fxTypeB, setFxTypeB] = useState('echo');
  const [fxDivisionA, setFxDivisionA] = useState(0.5);
  const [fxDivisionB, setFxDivisionB] = useState(0.5);
  const [fxTarget, setFxTarget] = useState('MASTER');
  const [masterFx, setMasterFx] = useState({ depth: 0, enabled: false, type: 'echo', division: 0.5 });
  const [syncMessage, setSyncMessage] = useState('');
  const [cuesA, setCuesA] = useState([null, null, null, null]);
  const [cuesB, setCuesB] = useState([null, null, null, null]);
  const [loops, setLoops] = useState({ A: null, B: null });
  const [loopLengths, setLoopLengths] = useState({ A: 4, B: 4 });
  const [loopStatus, setLoopStatus] = useState('');
  const [positionA, setPositionA] = useState(0);
  const [positionB, setPositionB] = useState(0);
  const [durationA, setDurationA] = useState(0);
  const [durationB, setDurationB] = useState(0);
  const [midiAccess, setMidiAccess] = useState(null);
  const [midiInputs, setMidiInputs] = useState([]);
  const [midiStatus, setMidiStatus] = useState('MIDI NOT CONNECTED');
  const [midiMappings, setMidiMappings] = useState(readSavedMidiMappings);
  const [selectedMidiAction, setSelectedMidiAction] = useState(MIDI_ACTIONS[0].id);
  const [isLearningMidi, setIsLearningMidi] = useState(false);
  const [libraryTracks, setLibraryTracks] = useState([]);
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryStatus, setLibraryStatus] = useState('OPENING LOCAL LIBRARY…');
  const [libraryAnalyzing, setLibraryAnalyzing] = useState(false);
  const [queue, setQueue] = useState(readSavedQueue);
  const [tempoTransitionMode, setTempoTransitionMode] = useState('OFF');
  const [tempoTransitionBars, setTempoTransitionBars] = useState(8);
  const [manualTargetBpm, setManualTargetBpm] = useState('');
  const [tempoTransition, setTempoTransition] = useState(null);
  const [tempoTransitionStatus, setTempoTransitionStatus] = useState('');
  const [gridEdit, setGridEdit] = useState(false);
  const [gridLocked, setGridLocked] = useState(true);
  const [quantize, setQuantize] = useState(false);
  const midiMappingsRef = useRef(midiMappings);
  const learningActionRef = useRef('');
  const midiActionHandlerRef = useRef(() => {});
  const midiTriggerStateRef = useRef({});
  const keyboardActionsRef = useRef({});
  const audioARef = useRef(null);
  const audioBRef = useRef(null);
  const cueAudioRef = useRef(null);
  const audioUrlsRef = useRef({ A: null, B: null });
  const analysisRequestRef = useRef({ A: 0, B: 0 });
  const audioContextRef = useRef(null);
  const audioGraphsRef = useRef({ A: null, B: null, master: null });
  const clipRef = useRef(false);
  const transitionTokenRef = useRef(0);
  const syncCorrectionTimerRef = useRef(null);
  const pendingSoftSyncRef = useRef(null);
  const startSoftSyncRef = useRef(() => {});
  const crossfaderUpdateRef = useRef({ lastRenderedAt: 0, pendingValue: 50, timer: null });

  midiMappingsRef.current = midiMappings;

  useEffect(() => {
    if ((!loops.A || !isPlayingA) && (!loops.B || !isPlayingB)) return undefined;
    let animationFrame;
    const updateLoops = () => {
      [
        { loop: loops.A, audio: audioARef.current, bpm: Number(deckA.bpm), setPosition: setPositionA },
        { loop: loops.B, audio: audioBRef.current, bpm: Number(deckB.bpm), setPosition: setPositionB },
      ].forEach(({ loop, audio, bpm, setPosition }) => {
        if (!loop || !audio || audio.paused || !Number.isFinite(bpm) || !(bpm > 0)) return;
        const loopSeconds = (loop.beats * 60) / bpm;
        if (!(loopSeconds > 0) || !Number.isFinite(loopSeconds)) return;
        const elapsed = audio.currentTime - loop.start;
        if (elapsed >= loopSeconds) {
          const position = loop.start + (elapsed % loopSeconds);
          audio.currentTime = position;
          setPosition(position);
        }
      });
      animationFrame = requestAnimationFrame(updateLoops);
    };
    animationFrame = requestAnimationFrame(updateLoops);
    return () => cancelAnimationFrame(animationFrame);
  }, [deckA.bpm, deckB.bpm, isPlayingA, isPlayingB, loops]);

  const cancelSyncCorrection = () => {
    pendingSoftSyncRef.current = null;
    const sync = syncCorrectionTimerRef.current;
    if (!sync) return;
    sync.active = false;
    if (sync.timer) window.clearTimeout(sync.timer);
    if (sync.animationFrame) cancelAnimationFrame(sync.animationFrame);
    if (sync.audio && sync.setPlaybackRate && Number.isFinite(sync.rate)) {
      sync.audio.playbackRate = sync.rate;
      sync.setPlaybackRate(sync.rate);
    }
    sync.audio?.removeEventListener('timeupdate', sync.update);
    sync.referenceAudio?.removeEventListener('timeupdate', sync.update);
    syncCorrectionTimerRef.current = null;
    setSyncMessage('SOFT SYNC RELEASED · MANUAL CONTROL');
  };

  useEffect(() => {
    let isMounted = true;
    readLibraryTracks()
      .then((tracks) => {
        if (!isMounted) return;
        setLibraryTracks(tracks);
        const savedTrackIds = new Set(tracks.map((track) => track.id));
        setQueue((current) => current.filter((trackId) => savedTrackIds.has(trackId)));
        setLibraryStatus(`${tracks.length} TRACK${tracks.length === 1 ? '' : 'S'} IN LOCAL LIBRARY`);
      })
      .catch((error) => {
        console.error('Could not open the local track library:', error);
        if (isMounted) setLibraryStatus(`LIBRARY UNAVAILABLE: ${error.message}`);
      });
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('nexus-dj-queue', JSON.stringify(queue));
    } catch (error) {
      console.error('Could not save the queue:', error);
      setLibraryStatus('QUEUE COULD NOT BE SAVED IN THIS BROWSER');
    }
  }, [queue]);

  useEffect(() => {
    try {
      localStorage.setItem('nexus-midi-mappings', JSON.stringify(midiMappings));
    } catch (error) {
      console.error('Could not save MIDI mappings:', error);
      setMidiStatus('MIDI MAPPING STORAGE UNAVAILABLE');
    }
  }, [midiMappings]);

  useEffect(() => {
    if (!midiAccess) return undefined;

    const refreshInputs = () => {
      const inputs = Array.from(midiAccess.inputs.values());
      setMidiInputs(inputs.map(({ id, name }) => ({ id, name: name || 'Unnamed MIDI device' })));
      setMidiStatus(inputs.length ? `${inputs.length} MIDI INPUT${inputs.length === 1 ? '' : 'S'} READY` : 'NO MIDI INPUT DETECTED');
      inputs.forEach((input) => {
        input.onmidimessage = (event) => {
          const [status, number, value] = event.data;
          const command = status & 0xf0;
          const channel = status & 0x0f;
          const type = command === 0xb0 ? 'cc' : command === 0x90 || command === 0x80 ? 'note' : null;
          if (!type || number === undefined || value === undefined) return;

          const noteOn = command === 0x90 && value > 0;
          const noteOff = command === 0x80 || (command === 0x90 && value === 0);
          const actionToLearn = learningActionRef.current;
          if (actionToLearn) {
            const action = MIDI_ACTIONS.find(({ id }) => id === actionToLearn);
            setMidiMappings((current) => ({
              ...current,
              [actionToLearn]: {
                inputId: input.id,
                inputName: input.name || 'Unnamed MIDI device',
                channel,
                type,
                number,
              },
            }));
            learningActionRef.current = '';
            setIsLearningMidi(false);
            setMidiStatus(`LEARNED ${action?.label.toUpperCase() || 'MIDI CONTROL'}`);
            return;
          }

          Object.entries(midiMappingsRef.current).forEach(([actionId, mapping]) => {
            if (
              mapping.inputId !== input.id
              || mapping.channel !== channel
              || mapping.type !== type
              || mapping.number !== number
            ) return;

            const action = MIDI_ACTIONS.find(({ id }) => id === actionId);
            if (!action) return;
            if (action.kind === 'trigger') {
              if (type === 'note' && noteOn) midiActionHandlerRef.current(actionId);
              if (type === 'cc') {
                const key = `${input.id}:${channel}:${type}:${number}`;
                const pressed = value >= 64;
                if (pressed && !midiTriggerStateRef.current[key]) midiActionHandlerRef.current(actionId);
                midiTriggerStateRef.current[key] = pressed;
              }
            } else if (type === 'cc' || (type === 'note' && !noteOff)) {
              midiActionHandlerRef.current(actionId, value / 127);
            }
          });
        };
      });
    };

    refreshInputs();
    midiAccess.onstatechange = refreshInputs;
    return () => {
      midiAccess.onstatechange = null;
      midiAccess.inputs.forEach((input) => { input.onmidimessage = null; });
    };
  }, [midiAccess]);

  useEffect(() => () => {
    Object.values(audioUrlsRef.current).forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    if (crossfaderUpdateRef.current.timer) clearTimeout(crossfaderUpdateRef.current.timer);
    if (audioContextRef.current) audioContextRef.current.close();
  }, []);

  const handleCrossfaderChange = (value) => {
    const update = crossfaderUpdateRef.current;
    update.pendingValue = value;
    setCrossfaderGains(audioGraphsRef.current, value);
    const now = performance.now();
    const elapsed = now - update.lastRenderedAt;
    if (elapsed >= 33) {
      update.lastRenderedAt = now;
      if (update.timer) clearTimeout(update.timer);
      update.timer = null;
      setCrossfader(value);
    } else if (!update.timer) {
      update.timer = setTimeout(() => {
        update.timer = null;
        update.lastRenderedAt = performance.now();
        setCrossfader(update.pendingValue);
      }, 33 - elapsed);
    }
  };

  useEffect(() => {
    setCrossfaderGains(audioGraphsRef.current, crossfader);
    if (audioARef.current && !audioGraphsRef.current.A) audioARef.current.volume = crossfader < 100 ? 1 : 0;
    if (audioBRef.current && !audioGraphsRef.current.B) audioBRef.current.volume = crossfader > 0 ? 1 : 0;
  }, [crossfader, deckA.audioUrl, deckB.audioUrl]);

  useEffect(() => {
    if (audioGraphsRef.current.A) {
      applyDeckAudioSettings(
        audioGraphsRef.current.A,
        eqA,
        fxA,
        fxEnabledA,
        fxTypeA,
        fxDivisionA,
        Number(deckA.bpm),
        channelGainA,
        channelVolumeA,
        channelFilterA,
        fxTarget === 'A',
      );
      audioGraphsRef.current.A.cueSend.gain.setTargetAtTime(cueA && cueOutput ? 0.65 : 0, audioGraphsRef.current.A.context.currentTime, 0.02);
    }
  }, [eqA, fxA, fxEnabledA, fxTypeA, fxDivisionA, deckA.bpm, channelGainA, channelVolumeA, channelFilterA, fxTarget, cueA, cueOutput]);

  useEffect(() => {
    if (audioGraphsRef.current.B) {
      applyDeckAudioSettings(
        audioGraphsRef.current.B,
        eqB,
        fxB,
        fxEnabledB,
        fxTypeB,
        fxDivisionB,
        Number(deckB.bpm),
        channelGainB,
        channelVolumeB,
        channelFilterB,
        fxTarget === 'B',
      );
      audioGraphsRef.current.B.cueSend.gain.setTargetAtTime(cueB && cueOutput ? 0.65 : 0, audioGraphsRef.current.B.context.currentTime, 0.02);
    }
  }, [eqB, fxB, fxEnabledB, fxTypeB, fxDivisionB, deckB.bpm, channelGainB, channelVolumeB, channelFilterB, fxTarget, cueB, cueOutput]);

  useEffect(() => {
    if (audioGraphsRef.current.master) {
      audioGraphsRef.current.master.gain.gain.setTargetAtTime(
        Math.min(1, Math.max(0, masterVolume / 100)),
        audioGraphsRef.current.master.context.currentTime,
        0.025,
      );
      applyEffectSettings(
        audioGraphsRef.current.master,
        masterFx.depth,
        masterFx.enabled,
        masterFx.type,
        masterFx.division,
        Math.max(Number(deckA.bpm) || 0, Number(deckB.bpm) || 0),
        fxTarget === 'MASTER',
      );
    }
  }, [masterVolume, masterFx, deckA.bpm, deckB.bpm, fxTarget]);

  const loadTrackFile = async (file, deck, libraryTrack = null) => {
    if (!file) return;

    cancelSyncCorrection();
    const requestId = ++analysisRequestRef.current[deck];
    const setDeck = deck === 'A' ? setDeckA : setDeckB;
    const cachedWaveformIsComplete = hasFullTrackWaveform(libraryTrack?.waveform);
    const audioUrl = URL.createObjectURL(file);
    const audio = deck === 'A' ? audioARef.current : audioBRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.playbackRate = 1;
    }
    (deck === 'A' ? setPlaybackRateA : setPlaybackRateB)(1);
    if (audioUrlsRef.current[deck]) {
      URL.revokeObjectURL(audioUrlsRef.current[deck]);
    }
    audioUrlsRef.current[deck] = audioUrl;
    (deck === 'A' ? setIsPlayingA : setIsPlayingB)(false);
    (deck === 'A' ? setCuesA : setCuesB)([null, null, null, null]);
    setLoops((current) => ({ ...current, [deck]: null }));
    (deck === 'A' ? setPositionA : setPositionB)(0);
    (deck === 'A' ? setDurationA : setDurationB)(0);
    setDeck((prev) => ({
      ...prev,
      name: file.name.toUpperCase(),
      bpm: libraryTrack?.bpm ?? '--',
      key: libraryTrack?.key ?? '--',
      energy: libraryTrack?.energy ?? '--',
      artist: libraryTrack?.artist || (file.name.includes(' - ') ? file.name.split(' - ')[0] : 'LOCAL FILE'),
      analysis: cachedWaveformIsComplete ? libraryTrack.waveform : null,
      audioUrl,
      libraryTrackId: libraryTrack?.id ?? null,
      loading: !libraryTrack?.bpm || !cachedWaveformIsComplete,
      error: null,
    }));

    if (libraryTrack?.bpm && cachedWaveformIsComplete) return;

    let localWaveform = null;
    let localWaveformError = null;
    const getLocalWaveform = async () => {
      if (localWaveform) return localWaveform;
      if (localWaveformError) return null;
      try {
        localWaveform = await createLocalPcmWaveform(file, audioContextRef);
      } catch (error) {
        localWaveformError = error;
        console.error('Could not build a local PCM waveform:', error);
      }
      return localWaveform;
    };
    try {
      const data = await analyzeTrackFile(file);

      if (data.status === 'success') {
        const waveform = hasFullTrackWaveform(data.waveform) ? data.waveform : await getLocalWaveform();
        if (requestId !== analysisRequestRef.current[deck]) return;
        if (!hasFullTrackWaveform(waveform)) {
          throw new Error(`Waveform generation failed${localWaveformError ? `: ${localWaveformError.message}` : '.'}`);
        }
        const analyzedTrack = {
          ...libraryTrack,
          bpm: data.bpm,
          key: data.key,
          energy: data.energy,
          musicalKey: data.musical_key,
          waveform,
          artist: file.name.includes(' - ') ? file.name.split(' - ')[0] : 'LOCAL FILE',
        };
        setDeck({
          name: data.filename.toUpperCase(),
          bpm: data.bpm,
          key: data.key,
          energy: data.energy,
          artist: file.name.includes(' - ') ? file.name.split(' - ')[0] : 'LOCAL FILE',
          analysis: waveform,
          audioUrl,
          libraryTrackId: libraryTrack?.id ?? null,
          loading: false,
          error: null,
        });
        if (libraryTrack) {
          try {
            await saveLibraryTrack(analyzedTrack);
            setLibraryTracks((tracks) => tracks.map((track) => (
              track.id === libraryTrack.id ? analyzedTrack : track
            )));
          } catch (error) {
            console.error('Track analysis succeeded but library metadata could not be saved:', error);
            setLibraryStatus(`TRACK ANALYZED, BUT LIBRARY UPDATE FAILED: ${error.message}`);
          }
        }
      } else {
        throw new Error(data.detail || 'The analysis service could not analyze this track.');
      }
    } catch (err) {
      if (requestId !== analysisRequestRef.current[deck]) return;
      const waveform = await getLocalWaveform();
      if (requestId !== analysisRequestRef.current[deck]) return;
      console.error('Track analysis request failed:', err);
      setDeck((prev) => ({
        ...prev,
        loading: false,
        analysis: waveform || prev.analysis,
        error: waveform
          ? `PCM waveform is ready, but BPM/key analysis failed: ${err.message}`
          : `Playback is ready, but waveform generation failed: ${localWaveformError?.message || err.message}`,
      }));
      if (libraryTrack && waveform) {
        try {
          const recoveredTrack = { ...libraryTrack, waveform };
          await saveLibraryTrack(recoveredTrack);
          setLibraryTracks((tracks) => tracks.map((track) => (
            track.id === libraryTrack.id ? recoveredTrack : track
          )));
        } catch (error) {
          console.error('PCM waveform was generated but could not be cached in the local library:', error);
          setLibraryStatus(`WAVEFORM READY, BUT LIBRARY CACHE FAILED: ${error.message}`);
        }
      }
    }
  };

  const handleFileUpload = async (event, deck) => {
    const file = event.target.files[0];
    event.target.value = '';
    await loadTrackFile(file, deck);
  };

  const handleLibraryImport = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;

    let imported = 0;
    let duplicates = 0;
    const failures = [];
    const signatures = new Set(libraryTracks.map((track) => (
      `${track.name.toLowerCase()}|${track.blob?.size ?? ''}|${track.lastModified ?? ''}`
    )));
    setLibraryStatus(`IMPORTING ${files.length} TRACK${files.length === 1 ? '' : 'S'}…`);
    for (const file of files) {
      const signature = `${file.name.toLowerCase()}|${file.size}|${file.lastModified}`;
      if (signatures.has(signature)) {
        duplicates += 1;
        continue;
      }
      const track = {
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
        blob: file,
        bpm: null,
        key: null,
        energy: null,
        musicalKey: null,
      };
      try {
        await saveLibraryTrack(track);
        signatures.add(signature);
        setLibraryTracks((current) => [...current, track].sort((first, second) => first.name.localeCompare(second.name)));
        imported += 1;
      } catch (error) {
        console.error(`Could not add ${file.name} to the local library:`, error);
        failures.push(`${file.name}: ${error.message}`);
      }
    }
    const parts = [];
    if (imported) parts.push(`SAVED ${imported}`);
    if (duplicates) parts.push(`${duplicates} ALREADY IN COLLECTION`);
    if (failures.length) parts.push(`${failures.length} FAILED`);
    setLibraryStatus(parts.join(' · ') || 'NO TRACKS ADDED');
    if (failures.length) console.error('Some selected tracks could not be saved:', failures);
  };

  const analyzeLibrary = async () => {
    if (isPlayingA || isPlayingB) {
      setLibraryStatus('PAUSE BOTH DECKS BEFORE ANALYZING THE LIBRARY TO AVOID AUDIO DROPOUTS');
      return;
    }
    if (libraryAnalyzing) return;
    const tracksToAnalyze = libraryTracks.filter((track) => (
      !(Number(track.bpm) > 0 && track.key && hasFullTrackWaveform(track.waveform))
    ));
    if (!tracksToAnalyze.length) {
      setLibraryStatus('ALL TRACKS ARE ANALYZED AND READY FOR TRANSITION MATCHING');
      return;
    }

    setLibraryAnalyzing(true);
    let analyzed = 0;
    const failures = [];
    try {
      for (const [index, track] of tracksToAnalyze.entries()) {
        setLibraryStatus(`ANALYZING ${index + 1}/${tracksToAnalyze.length} · ${track.name}`);
        try {
          const file = new File([track.blob], track.name, {
            type: track.type || track.blob.type,
            lastModified: track.lastModified || Date.now(),
          });
          const data = await analyzeTrackFile(file);
          let waveform = hasFullTrackWaveform(data.waveform) ? data.waveform : track.waveform;
          if (!hasFullTrackWaveform(waveform)) {
            waveform = await createLocalPcmWaveform(file, audioContextRef);
          }
          const analyzedTrack = {
            ...track,
            bpm: Number(data.bpm),
            key: data.key || null,
            energy: data.energy ?? null,
            musicalKey: data.musical_key || null,
            waveform,
            analysisError: null,
          };
          await saveLibraryTrack(analyzedTrack);
          setLibraryTracks((current) => current.map((entry) => (
            entry.id === analyzedTrack.id ? analyzedTrack : entry
          )));
          analyzed += 1;
        } catch (error) {
          console.error(`Could not analyze library track ${track.name}:`, error);
          failures.push(track.name);
          const failedTrack = { ...track, analysisError: error.message };
          setLibraryTracks((current) => current.map((entry) => (
            entry.id === failedTrack.id ? failedTrack : entry
          )));
        }
      }
      setLibraryStatus(
        `ANALYZED ${analyzed}/${tracksToAnalyze.length}`
        + (failures.length ? ` · FAILED: ${failures.join(', ')}` : ' · READY FOR TRANSITION MATCHING'),
      );
    } finally {
      setLibraryAnalyzing(false);
    }
  };

  const addToQueue = (trackId) => {
    setQueue((current) => (current.includes(trackId) ? current : [...current, trackId]));
  };

  const removeFromQueue = (trackId) => {
    setQueue((current) => current.filter((id) => id !== trackId));
  };

  const loadLibraryTrackToDeck = async (trackId, deck, removeFromQueueAfterLoad = false) => {
    try {
      const track = await readLibraryTrack(trackId);
      if (!track) throw new Error('This track is no longer in the local library.');
      const file = new File([track.blob], track.name, { type: track.type, lastModified: track.lastModified });
      await loadTrackFile(file, deck, track);
      setActiveDeck(deck);
      if (removeFromQueueAfterLoad) removeFromQueue(trackId);
    } catch (error) {
      console.error('Could not load a track from the local library:', error);
      setLibraryStatus(`TRACK LOAD FAILED: ${error.message}`);
    }
  };

  const removeLibraryTrack = async (trackId) => {
    try {
      await deleteLibraryTrack(trackId);
      setLibraryTracks((tracks) => tracks.filter((track) => track.id !== trackId));
      removeFromQueue(trackId);
      setLibraryStatus('TRACK REMOVED FROM LOCAL LIBRARY');
    } catch (error) {
      console.error('Could not remove a track from the local library:', error);
      setLibraryStatus(`TRACK REMOVAL FAILED: ${error.message}`);
    }
  };

  const selectCueOutput = async () => {
    if (!navigator.mediaDevices?.selectAudioOutput || !cueAudioRef.current?.setSinkId) {
      setCueOutputStatus('SEPARATE HEADPHONE OUTPUT IS NOT SUPPORTED BY THIS BROWSER');
      return;
    }
    try {
      const device = await navigator.mediaDevices.selectAudioOutput();
      const Context = window.AudioContext;
      if (!Context) throw new Error('Web Audio is not supported by this browser.');
      const context = audioContextRef.current || (audioContextRef.current = new Context());
      if (!audioGraphsRef.current.master) {
        audioGraphsRef.current.master = createMasterAudioGraph(context, masterVolume);
      }
      cueAudioRef.current.srcObject = audioGraphsRef.current.master.cueDestination.stream;
      await cueAudioRef.current.setSinkId(device.deviceId);
      await context.resume();
      await cueAudioRef.current.play();
      setCueOutput({ id: device.deviceId, label: device.label || 'Selected headphone output' });
      setCueOutputStatus(`CUE OUTPUT · ${device.label || 'HEADPHONES'}`);
    } catch (error) {
      console.error('Could not select a headphone output:', error);
      setCueOutputStatus(`HEADPHONE OUTPUT NOT AVAILABLE: ${error.message}`);
    }
  };

  const togglePlayback = async (deck) => {
    const audio = deck === 'A' ? audioARef.current : audioBRef.current;
    const setPlaying = deck === 'A' ? setIsPlayingA : setIsPlayingB;
    const setDeck = deck === 'A' ? setDeckA : setDeckB;

    if (!audio) return;

    if (audio.paused) {
      if (libraryAnalyzing) {
        setLibraryStatus('PAUSE BOTH DECKS WHILE LIBRARY ANALYSIS IS RUNNING');
        return;
      }
      try {
        const Context = window.AudioContext;
        if (!Context) throw new Error('Web Audio is not supported by this browser.');
        const context = audioContextRef.current || (audioContextRef.current = new Context());
        if (!audioGraphsRef.current.master) {
          audioGraphsRef.current.master = createMasterAudioGraph(context, masterVolume);
        }
        let graph = audioGraphsRef.current[deck];
        if (!graph) {
          audio.volume = 1;
          graph = createDeckAudioGraph(audio, context, audioGraphsRef.current.master);
          audioGraphsRef.current[deck] = graph;
          setCrossfaderGains(audioGraphsRef.current, crossfader);
        }
        applyDeckAudioSettings(
          graph,
          deck === 'A' ? eqA : eqB,
          deck === 'A' ? fxA : fxB,
          deck === 'A' ? fxEnabledA : fxEnabledB,
          deck === 'A' ? fxTypeA : fxTypeB,
          deck === 'A' ? fxDivisionA : fxDivisionB,
          Number(deck === 'A' ? deckA.bpm : deckB.bpm),
          deck === 'A' ? channelGainA : channelGainB,
          deck === 'A' ? channelVolumeA : channelVolumeB,
          deck === 'A' ? channelFilterA : channelFilterB,
          fxTarget === deck,
        );
        applyEffectSettings(
          audioGraphsRef.current.master,
          masterFx.depth,
          masterFx.enabled,
          masterFx.type,
          masterFx.division,
          Math.max(Number(deckA.bpm) || 0, Number(deckB.bpm) || 0),
          fxTarget === 'MASTER',
        );
        await context.resume();
        if (quantize) {
          const currentDeck = deck === 'A' ? deckA : deckB;
          const bpm = Number(currentDeck.bpm);
          if (bpm > 0) {
            const anchor = currentDeck.analysis?.firstBeatTime ?? currentDeck.analysis?.beats?.[0] ?? 0;
            const beatSeconds = 60 / bpm;
            audio.currentTime = Math.max(
              0,
              Math.min(audio.duration || Infinity, anchor + Math.round((audio.currentTime - anchor) / beatSeconds) * beatSeconds),
            );
            (deck === 'A' ? setPositionA : setPositionB)(audio.currentTime);
          }
        }
        await audio.play();
        setPlaying(true);
        setDeck((prev) => ({ ...prev, error: null }));
      } catch (err) {
        setDeck((prev) => ({ ...prev, error: `Could not play this audio file: ${err.message}` }));
      }
    } else {
      cancelSyncCorrection();
      audio.pause();
      setPlaying(false);
    }
  };

  const setHotCue = (deck, index) => {
    const audio = deck === 'A' ? audioARef.current : audioBRef.current;
    const setCues = deck === 'A' ? setCuesA : setCuesB;
    if (!audio || !audioUrlsRef.current[deck]) return;
    const cues = deck === 'A' ? cuesA : cuesB;
    const updatedCues = [...cues];
    const bpm = Number((deck === 'A' ? deckA : deckB).bpm);
    const cueAnalysis = (deck === 'A' ? deckA : deckB).analysis;
    const anchor = cueAnalysis?.firstBeatTime ?? cueAnalysis?.beats?.[0] ?? 0;
    updatedCues[index] = quantize && bpm > 0
      ? anchor + Math.round((audio.currentTime - anchor) / (60 / bpm)) * (60 / bpm)
      : audio.currentTime;
    setCues(updatedCues);
  };

  const triggerHotCue = async (deck, index) => {
    const audio = deck === 'A' ? audioARef.current : audioBRef.current;
    const cues = deck === 'A' ? cuesA : cuesB;
    if (!audio || !audioUrlsRef.current[deck]) return;
    if (cues[index] === null) {
      setHotCue(deck, index);
      return;
    }
    seekDeck(deck, cues[index]);
    if (audio.paused) await togglePlayback(deck);
  };

  const cueDeck = (deck) => {
    const audio = deck === 'A' ? audioARef.current : audioBRef.current;
    const cues = deck === 'A' ? cuesA : cuesB;
    const setPlaying = deck === 'A' ? setIsPlayingA : setIsPlayingB;
    const setPosition = deck === 'A' ? setPositionA : setPositionB;
    if (!audio) return;
    audio.pause();
    seekDeck(deck, cues[0] ?? 0);
    setPosition(audio.currentTime);
    setPlaying(false);
  };

  const seekDeck = (deck, value) => {
    const audio = deck === 'A' ? audioARef.current : audioBRef.current;
    const current = deck === 'A' ? deckA : deckB;
    cancelSyncCorrection();
    const bpm = Number(current.bpm);
    const interval = bpm > 0 ? 60 / bpm : 0;
    const anchor = current.analysis?.firstBeatTime ?? current.analysis?.beats?.[0] ?? 0;
    const duration = audio?.duration || current.analysis?.duration || Infinity;
    const requested = quantize && interval > 0
      ? anchor + Math.round((value - anchor) / interval) * interval
      : value;
    const position = Math.max(0, Math.min(duration, requested));
    if (audio) audio.currentTime = position;
    (deck === 'A' ? setPositionA : setPositionB)(position);
  };

  const updateTrackGrid = async (deck, { bpm: bpmInput, firstBeatTime: anchorInput }) => {
    const isA = deck === 'A';
    const currentDeck = isA ? deckA : deckB;
    const bpm = Number(bpmInput ?? currentDeck.bpm);
    const audio = isA ? audioARef.current : audioBRef.current;
    if (!(bpm >= 40 && bpm <= 240)) {
      setLibraryStatus('GRID BPM MUST BE BETWEEN 40 AND 240');
      return;
    }
    cancelSyncCorrection();
    const duration = currentDeck.analysis?.duration || audio?.duration || 0;
    const previousAnalysis = currentDeck.analysis || {};
    const firstBeatTime = Math.max(0, Math.min(
      duration || Number.MAX_SAFE_INTEGER,
      Number(anchorInput ?? previousAnalysis.firstBeatTime ?? previousAnalysis.beats?.[0] ?? 0),
    ));
    const beats = makeBeatGrid(firstBeatTime, bpm, duration);
    const barPositions = beats.filter((_, index) => {
      const interval = 60 / bpm;
      const beatNumber = Math.round((beats[index] - firstBeatTime) / interval);
      return beatNumber % 4 === 0;
    });
    const analysis = {
      ...previousAnalysis,
      firstBeatTime,
      beatInterval: 60 / bpm,
      beats,
      beatPositions: beats,
      barPositions,
      timeSignature: previousAnalysis.timeSignature || [4, 4],
      gridSource: 'manual',
    };
    const setDeck = isA ? setDeckA : setDeckB;
    setDeck((previous) => ({ ...previous, bpm, analysis }));
    if (audio && Number.isFinite(audio.currentTime)) {
      (isA ? setPositionA : setPositionB)(audio.currentTime);
    }

    if (!currentDeck.libraryTrackId) return;
    try {
      const track = await readLibraryTrack(currentDeck.libraryTrackId);
      if (!track) throw new Error('The source track is no longer in the local library.');
      const updatedTrack = { ...track, bpm, waveform: analysis };
      await saveLibraryTrack(updatedTrack);
      setLibraryTracks((tracks) => tracks.map((item) => (
        item.id === updatedTrack.id ? updatedTrack : item
      )));
      setLibraryStatus(`BEAT GRID SAVED · ${updatedTrack.name}`);
    } catch (error) {
      console.error('The beat grid changed but could not be saved to the local library:', error);
      setLibraryStatus(`GRID CHANGED, BUT COULD NOT BE SAVED: ${error.message}`);
    }
  };

  const setBeatOne = (deck, time) => {
    if (gridLocked || !gridEdit) return;
    void updateTrackGrid(deck, { firstBeatTime: time });
  };

  const correctDeckBpm = (deck, nextBpm) => {
    void updateTrackGrid(deck, { bpm: nextBpm });
  };

  const nudgeDeck = (deck, beatFraction) => {
    const currentDeck = deck === 'A' ? deckA : deckB;
    const audio = deck === 'A' ? audioARef.current : audioBRef.current;
    const bpm = Number(currentDeck.bpm);
    if (!audio || !(bpm > 0)) return;
    cancelSyncCorrection();
    const amount = (60 / bpm) * beatFraction;
    const position = Math.max(0, Math.min(audio.duration || Infinity, audio.currentTime + amount));
    audio.currentTime = position;
    (deck === 'A' ? setPositionA : setPositionB)(position);
  };

  const setBeatLoop = (deck, beats) => {
    const audio = deck === 'A' ? audioARef.current : audioBRef.current;
    const currentDeck = deck === 'A' ? deckA : deckB;
    const bpm = Number(currentDeck.bpm);
    if (!audio || !Number.isFinite(bpm) || !(bpm > 0)) {
      setLoopStatus(`LOAD AND ANALYZE DECK ${deck} BEFORE SETTING A BEAT LOOP`);
      return;
    }

    cancelSyncCorrection();
    const anchor = Number(currentDeck.analysis?.firstBeatTime ?? currentDeck.analysis?.beats?.[0] ?? 0);
    if (!Number.isFinite(anchor)) {
      setLoopStatus(`DECK ${deck} HAS AN INVALID BEAT GRID · REANALYZE THE TRACK`);
      return;
    }
    const loopSeconds = (beats * 60) / bpm;
    const loopIndex = Math.ceil((audio.currentTime - anchor) / loopSeconds - 1e-9);
    const start = anchor + loopIndex * loopSeconds;
    if (Number.isFinite(audio.duration) && start + loopSeconds > audio.duration) {
      setLoopStatus(`MOVE DECK ${deck} EARLIER TO FIT A ${formatLoopLength(beats)} LOOP`);
      return;
    }

    setLoopLengths((current) => ({ ...current, [deck]: beats }));
    setLoops((current) => ({
      ...current,
      [deck]: { beats, start },
    }));
    setLoopStatus(`DECK ${deck} ${formatLoopLength(beats)} LOOP ACTIVE · GRID LOCKED`);
  };

  const toggleBeatLoop = (deck, beats) => {
    if (loops[deck]?.beats === beats) {
      setLoops((current) => ({ ...current, [deck]: null }));
      setLoopStatus(`DECK ${deck} LOOP EXITED`);
      return;
    }

    setBeatLoop(deck, beats);
  };

  const changeLoopLength = (deck, beats) => {
    setLoopLengths((current) => ({ ...current, [deck]: beats }));
    if (loops[deck] && loops[deck].beats !== beats) setBeatLoop(deck, beats);
  };

  const handleDeckTimeUpdate = (deck, event) => {
    const audio = event.currentTarget;
    const currentTime = audio.currentTime;
    (deck === 'A' ? setPositionA : setPositionB)(currentTime);
  };

  const startSoftSync = (intent) => {
    const {
      deck,
      audio,
      referenceAudio,
      tempo,
      referenceTempo,
      ownAnchor,
      referenceAnchor,
      minimumRate,
      maximumRate,
      pitchRange,
      setPlaybackRate,
    } = intent;
    if (!audio || !referenceAudio || audio.paused || referenceAudio.paused) return false;

    const sync = {
      active: true,
      audio,
      referenceAudio,
      rate: audio.playbackRate,
      setPlaybackRate,
      animationFrame: 0,
      lastStatusAt: 0,
      lastRateStateAt: 0,
      lastPublishedRate: audio.playbackRate,
      update: null,
    };
    sync.update = (timestamp) => {
      if (!sync.active || syncCorrectionTimerRef.current !== sync) return;
      const isAnimationFrame = typeof timestamp === 'number';
      if (isAnimationFrame) sync.animationFrame = 0;
      if (audio.paused || referenceAudio.paused) {
        cancelSyncCorrection();
        return;
      }
      const now = isAnimationFrame ? timestamp : performance.now();
      const nextTargetRate = (referenceTempo * referenceAudio.playbackRate) / tempo;
      if (nextTargetRate < minimumRate || nextTargetRate > maximumRate) {
        setSyncMessage(`SOFT SYNC STOPPED · Deck ${deck} target exceeds its selected ±${pitchRange}% pitch range.`);
        cancelSyncCorrection();
        return;
      }
      sync.rate = nextTargetRate;
      const currentOwnPhase = getBeatPhase(audio.currentTime, ownAnchor, tempo);
      const currentReferencePhase = getBeatPhase(referenceAudio.currentTime, referenceAnchor, referenceTempo);
      const currentDifference = getBarPhaseDifference(currentOwnPhase, currentReferencePhase);
      const phaseTrim = Math.abs(currentDifference) < PHASE_ALIGNMENT_TOLERANCE
        ? 0
        : Math.max(-0.04, Math.min(0.04, currentDifference * 0.12));
      const minimumCorrectionRate = Math.max(0.5, nextTargetRate * 0.96);
      const maximumCorrectionRate = Math.min(2, nextTargetRate * 1.04);
      const correctionRate = Math.max(
        minimumCorrectionRate,
        Math.min(maximumCorrectionRate, nextTargetRate * (1 + phaseTrim)),
      );
      if (Math.abs(audio.playbackRate - correctionRate) > 0.0002) {
        audio.playbackRate = correctionRate;
        if (
          now - sync.lastRateStateAt >= 100
          && Math.abs(sync.lastPublishedRate - correctionRate) > 0.0002
        ) {
          setPlaybackRate(correctionRate);
          sync.lastPublishedRate = correctionRate;
          sync.lastRateStateAt = now;
        }
      }
      if (now - sync.lastStatusAt > 400) {
        const effectiveTempo = tempo * audio.playbackRate;
        setSyncMessage(Math.abs(currentDifference) < PHASE_ALIGNMENT_TOLERANCE
          ? `SOFT SYNC ACTIVE · DECK ${deck} GRID ALIGNED · 0.00 BEAT · ${effectiveTempo.toFixed(1)} BPM`
          : `SOFT SYNC ACTIVE · DECK ${deck} CORRECTING ${currentDifference > 0 ? '+' : ''}${currentDifference.toFixed(2)} BEAT`);
        sync.lastStatusAt = now;
      }
      if (isAnimationFrame || !sync.animationFrame) {
        sync.animationFrame = requestAnimationFrame(sync.update);
      }
    };
    syncCorrectionTimerRef.current = sync;
    audio.addEventListener('timeupdate', sync.update);
    referenceAudio.addEventListener('timeupdate', sync.update);
    sync.animationFrame = requestAnimationFrame(sync.update);
    setSyncMessage(`SOFT SYNC ACTIVE · DECK ${deck} ALIGNING PHASE`);
    return true;
  };
  startSoftSyncRef.current = startSoftSync;

  const syncDeckToOther = (deck) => {
    const isDeckA = deck === 'A';
    const audio = isDeckA ? audioARef.current : audioBRef.current;
    const referenceAudio = isDeckA ? audioBRef.current : audioARef.current;
    const tempo = Number(isDeckA ? deckA.bpm : deckB.bpm);
    const referenceTempo = Number(isDeckA ? deckB.bpm : deckA.bpm);
    const setDeck = isDeckA ? setDeckA : setDeckB;

    if (!audio || !referenceAudio || !(tempo > 0) || !(referenceTempo > 0)) {
      const message = `Load and analyze both tracks before syncing Deck ${deck}.`;
      setSyncMessage(message);
      setDeck((prev) => ({ ...prev, error: message }));
      return;
    }

    cancelSyncCorrection();
    const targetTempo = referenceTempo * referenceAudio.playbackRate;
    const playbackRate = targetTempo / tempo;
    const pitchRange = isDeckA ? pitchRangeA : pitchRangeB;
    const minimumRate = 1 - pitchRange / 100;
    const maximumRate = 1 + pitchRange / 100;
    if (playbackRate < minimumRate || playbackRate > maximumRate) {
      const message = `Deck ${deck} needs ${playbackRate.toFixed(2)}× to sync, outside its selected ±${pitchRange}% pitch range.`;
      setSyncMessage(message);
      setDeck((prev) => ({ ...prev, error: message }));
      return;
    }

    const ownAnalysis = (isDeckA ? deckA : deckB).analysis;
    const referenceAnalysis = (isDeckA ? deckB : deckA).analysis;
    const ownAnchor = ownAnalysis?.firstBeatTime ?? ownAnalysis?.beats?.[0] ?? 0;
    const referenceAnchor = referenceAnalysis?.firstBeatTime ?? referenceAnalysis?.beats?.[0] ?? 0;
    const ownPhase = getBeatPhase(audio.currentTime, ownAnchor, tempo);
    const referencePhase = getBeatPhase(referenceAudio.currentTime, referenceAnchor, referenceTempo);
    const phaseDifference = getBarPhaseDifference(ownPhase, referencePhase);
    const setPlaybackRate = isDeckA ? setPlaybackRateA : setPlaybackRateB;
    const intent = {
      deck,
      audio,
      referenceAudio,
      tempo,
      referenceTempo,
      ownAnchor,
      referenceAnchor,
      minimumRate,
      maximumRate,
      pitchRange,
      setPlaybackRate,
    };
    audio.playbackRate = playbackRate;
    setPlaybackRate(playbackRate);
    pendingSoftSyncRef.current = intent;
    if (!audio.paused && !referenceAudio.paused) {
      pendingSoftSyncRef.current = null;
      startSoftSync(intent);
    } else if (!audio.paused && referenceAudio.paused) {
      setSyncMessage(`Deck ${deck} BPM matched; start both decks to phase-sync without an audio jump.`);
    } else {
      const phaseShift = phaseDifference * (60 / tempo);
      const requestedPosition = audio.currentTime + phaseShift;
      const position = Math.max(0, Math.min(audio.duration || Infinity, requestedPosition));
      audio.currentTime = position;
      const correctedPosition = audio.currentTime;
      (isDeckA ? setPositionA : setPositionB)(correctedPosition);
      const correctedPhase = getBeatPhase(correctedPosition, ownAnchor, tempo);
      const remainingOffset = getBarPhaseDifference(correctedPhase, referencePhase);
      const hitTrackBoundary = Math.abs(position - requestedPosition) > 0.001;
      if (Math.abs(remainingOffset) < PHASE_ALIGNMENT_TOLERANCE) {
        setSyncMessage(`SYNC COMPLETE · DECK ${deck} GRID ALIGNED · 0.00 BEAT · ${targetTempo.toFixed(1)} BPM; soft sync engages when both decks play.`);
      } else {
        setSyncMessage(`SYNC INCOMPLETE · DECK ${deck} OFFSET ${remainingOffset > 0 ? '+' : ''}${remainingOffset.toFixed(2)} BEAT${hitTrackBoundary ? ' · TRACK BOUNDARY' : ''}; check the analyzed grids.`);
      }
    }
    setDeck((prev) => ({ ...prev, error: null }));
  };

  keyboardActionsRef.current = {
    togglePlayback,
    triggerHotCue,
    syncDeckToOther,
    nudgeDeck,
    seekDeck,
    correctDeckBpm,
    cueDeck,
    adjustPlaybackRate: (deck, direction) => {
      const audio = deck === 'A' ? audioARef.current : audioBRef.current;
      if (!audio) return;
      cancelSyncCorrection();
      const nextRate = Math.max(0.5, Math.min(2, audio.playbackRate * (direction > 0 ? 1.001 : 0.999)));
      audio.playbackRate = nextRate;
      (deck === 'A' ? setPlaybackRateA : setPlaybackRateB)(nextRate);
    },
  };

  useEffect(() => {
    if (!isPlayingA || !isPlayingB) return;
    const intent = pendingSoftSyncRef.current;
    if (!intent || intent.audio.paused || intent.referenceAudio.paused) return;
    pendingSoftSyncRef.current = null;
    startSoftSyncRef.current(intent);
  }, [isPlayingA, isPlayingB]);

  useEffect(() => {
    const handleKeyboardShortcuts = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const target = event.target;
      if (
        target instanceof HTMLElement
        && (target.isContentEditable || target.closest('input, textarea, select, [role="slider"]'))
      ) return;

      if (event.code === 'Space') {
        if (target instanceof HTMLElement && target.closest('button')) return;
        event.preventDefault();
        void keyboardActionsRef.current.togglePlayback(activeDeck);
      } else if (/^[1-4]$/.test(event.key)) {
        void keyboardActionsRef.current.triggerHotCue(activeDeck, Number(event.key) - 1);
      } else if (event.key.toLowerCase() === 's') {
        keyboardActionsRef.current.syncDeckToOther(activeDeck);
      } else if (event.key.toLowerCase() === 'a') {
        void keyboardActionsRef.current.togglePlayback('A');
      } else if (event.key.toLowerCase() === 'l') {
        void keyboardActionsRef.current.togglePlayback('B');
      } else if (event.key.toLowerCase() === 'q') {
        keyboardActionsRef.current.cueDeck('A');
      } else if (event.key.toLowerCase() === 'p') {
        keyboardActionsRef.current.cueDeck('B');
      } else if (event.key.toLowerCase() === 'k') {
        keyboardActionsRef.current.syncDeckToOther('B');
      } else if (event.key.toLowerCase() === 'z') {
        keyboardActionsRef.current.nudgeDeck('A', -0.1);
      } else if (event.key.toLowerCase() === 'x') {
        keyboardActionsRef.current.nudgeDeck('A', 0.1);
      } else if (event.key.toLowerCase() === 'n') {
        keyboardActionsRef.current.nudgeDeck('B', -0.1);
      } else if (event.key.toLowerCase() === 'm') {
        keyboardActionsRef.current.nudgeDeck('B', 0.1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        keyboardActionsRef.current.nudgeDeck(activeDeck, event.key === 'ArrowRight' ? 0.02 : -0.02);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        keyboardActionsRef.current.adjustPlaybackRate(activeDeck, event.key === 'ArrowUp' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', handleKeyboardShortcuts);
    return () => window.removeEventListener('keydown', handleKeyboardShortcuts);
  }, [activeDeck]);

  useEffect(() => {
    let animationFrame;
    const keepLoopsTight = () => {
      [['A', loops.A, deckA.bpm], ['B', loops.B, deckB.bpm]].forEach(([deck, loop, bpmValue]) => {
        const audio = deck === 'A' ? audioARef.current : audioBRef.current;
        const bpm = Number(bpmValue);
        if (!loop || !audio || audio.paused || !(bpm > 0)) return;
        const loopSeconds = (loop.beats * 60) / bpm;
        if (audio.currentTime >= loop.start + loopSeconds) audio.currentTime = loop.start;
      });
      animationFrame = requestAnimationFrame(keepLoopsTight);
    };

    if ((loops.A && isPlayingA) || (loops.B && isPlayingB)) {
      animationFrame = requestAnimationFrame(keepLoopsTight);
    }
    return () => cancelAnimationFrame(animationFrame);
  }, [loops, isPlayingA, isPlayingB, deckA.bpm, deckB.bpm]);

  const bpmValueA = Number(deckA.bpm);
  const bpmValueB = Number(deckB.bpm);
  const hasBothTracks = Boolean(deckA.audioUrl && deckB.audioUrl && bpmValueA > 0 && bpmValueB > 0);
  const beatAnchorA = deckA.analysis?.firstBeatTime ?? deckA.analysis?.beats?.[0] ?? 0;
  const beatAnchorB = deckB.analysis?.firstBeatTime ?? deckB.analysis?.beats?.[0] ?? 0;
  const beatPhaseA = getBeatPhase(positionA, beatAnchorA, bpmValueA);
  const beatPhaseB = getBeatPhase(positionB, beatAnchorB, bpmValueB);
  const beatPhaseOffset = getBarPhaseDifference(beatPhaseA, beatPhaseB);
  const phaseGap = Math.abs(beatPhaseOffset);
  const displayedBeatOffset = phaseGap < PHASE_ALIGNMENT_TOLERANCE ? 0 : beatPhaseOffset;
  const beatCountA = bpmValueA > 0 ? Math.max(0, Math.floor((positionA - beatAnchorA) * bpmValueA / 60)) : 0;
  const beatCountB = bpmValueB > 0 ? Math.max(0, Math.floor((positionB - beatAnchorB) * bpmValueB / 60)) : 0;
  const barPositionA = `${Math.floor(beatCountA / 4) + 1}.${(beatCountA % 4) + 1}`;
  const barPositionB = `${Math.floor(beatCountB / 4) + 1}.${(beatCountB % 4) + 1}`;
  const tempoGap = Math.abs(bpmValueA * playbackRateA - bpmValueB * playbackRateB);
  const meanTempo = ((bpmValueA * playbackRateA) + (bpmValueB * playbackRateB)) / 2;
  const phaseOffsetMilliseconds = meanTempo > 0 ? beatPhaseOffset * 60000 / meanTempo : 0;
  const softSyncActive = Boolean(syncCorrectionTimerRef.current?.active);
  const phaseLabel = !hasBothTracks
    ? 'LOAD BOTH TRACKS'
    : tempoGap > 0.5 && !softSyncActive
      ? 'TEMPO MISMATCH'
      : phaseGap < PHASE_ALIGNMENT_TOLERANCE && tempoGap < 0.05
      ? 'ALIGNED'
      : phaseGap < 0.2 || softSyncActive
        ? 'CLOSE'
        : 'OFFSET';
  const outgoingDeck = crossfader > 50 ? 'A' : 'B';
  const incomingDeck = outgoingDeck === 'A' ? 'B' : 'A';
  const outgoingTempo = outgoingDeck === 'A' ? bpmValueA : bpmValueB;
  const outgoingPosition = outgoingDeck === 'A' ? positionA : positionB;
  const beatsToPhrase = hasBothTracks && outgoingTempo > 0
    ? (16 - (((outgoingPosition - (outgoingDeck === 'A' ? beatAnchorA : beatAnchorB)) * outgoingTempo / 60) % 16)) % 16
    : 16;
  const suggestedFx = !hasBothTracks || phaseGap > 0.2
    ? { deck: incomingDeck, type: 'filter', division: 0.5, reason: 'Filter sweep on the incoming deck while you load, start, and beat-sync the tracks.' }
    : beatsToPhrase < 2
      ? { deck: incomingDeck, type: 'filter', division: 0.5, reason: 'A phrase boundary is approaching; sweep the incoming deck in over the next half-beat.' }
      : { deck: outgoingDeck, type: 'echo', division: 0.5, reason: 'Beat grids are close; a half-beat echo on the outgoing deck can carry its final beat into the handoff.' };

  const applySuggestedFx = () => {
    setFxTarget(suggestedFx.deck);
    if (suggestedFx.deck === 'A') {
      setFxTypeA(suggestedFx.type);
      setFxDivisionA(suggestedFx.division);
      setFxA(45);
      setFxEnabledA(true);
    } else {
      setFxTypeB(suggestedFx.type);
      setFxDivisionB(suggestedFx.division);
      setFxB(45);
      setFxEnabledB(true);
    }
  };

  const requestMidiAccess = async () => {
    if (!navigator.requestMIDIAccess) {
      setMidiStatus('WEB MIDI IS NOT SUPPORTED IN THIS BROWSER');
      return;
    }
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      setMidiAccess(access);
    } catch (error) {
      console.error('Could not access MIDI devices:', error);
      setMidiStatus(`MIDI ACCESS DENIED: ${error.message}`);
    }
  };

  const startMidiLearn = () => {
    learningActionRef.current = selectedMidiAction;
    setIsLearningMidi(true);
    setMidiStatus(`MOVE OR PRESS A CONTROL FOR ${MIDI_ACTIONS.find(({ id }) => id === selectedMidiAction)?.label.toUpperCase()}`);
  };

  const clearMidiMapping = () => {
    setMidiMappings((current) => {
      const updated = { ...current };
      delete updated[selectedMidiAction];
      return updated;
    });
    setMidiStatus('MIDI MAPPING CLEARED');
  };

  midiActionHandlerRef.current = (actionId, value) => {
    if (actionId === 'playA') void togglePlayback('A');
    else if (actionId === 'playB') void togglePlayback('B');
    else if (actionId === 'syncA') syncDeckToOther('A');
    else if (actionId === 'syncB') syncDeckToOther('B');
    else if (actionId === 'crossfader') setCrossfader(Math.round(value * 100));
    else if (actionId.startsWith('cueA')) void triggerHotCue('A', Number(actionId.slice(-1)) - 1);
    else if (actionId.startsWith('cueB')) void triggerHotCue('B', Number(actionId.slice(-1)) - 1);
    else if (actionId === 'fxA') {
      const depth = Math.round(value * 100);
      setFxTarget('A');
      setFxA(depth);
      setFxEnabledA(depth > 0);
    } else if (actionId === 'fxB') {
      const depth = Math.round(value * 100);
      setFxTarget('B');
      setFxB(depth);
      setFxEnabledB(depth > 0);
    } else {
      const deck = actionId.endsWith('A') ? 'A' : 'B';
      const band = actionId.slice(0, -1);
      const setEq = deck === 'A' ? setEqA : setEqB;
      setEq((current) => ({ ...current, [band]: Math.round(value * 100) }));
    }
  };

  // Calculate loaded-deck compatibility.
  const getRecommendation = () => {
    if (deckA.bpm === '--' || deckB.bpm === '--') {
      return { status: 'idle', message: 'Load tracks into both Deck A and Deck B to compute harmonic transition compatibility.' };
    }

    const bpmDiff = Math.abs(parseFloat(deckA.bpm) - parseFloat(deckB.bpm));
    const isHarmonic = deckA.key === deckB.key;

    if (bpmDiff <= 4 && isHarmonic) {
      return {
        status: 'perfect',
        message: `PERFECT MIX MATCH! Exact key alignment (${deckA.key}) and minimal tempo delta (${bpmDiff.toFixed(1)} BPM). Perfect for long seamless transitions.`
      };
    } else if (bpmDiff <= 8) {
      return {
        status: 'good',
        message: `COMPATIBLE MIX: Tempo delta is ${bpmDiff.toFixed(1)} BPM. Use pitch fader pitch bend to adjust tempo alignment.`
      };
    } else {
      return {
        status: 'warning',
        message: `HIGH TEMPO SHIFT (${bpmDiff.toFixed(1)} BPM delta). Recommend performing a drop mix or breakdown transition.`
      };
    }
  };

  const rec = getRecommendation();
  const filteredLibraryTracks = libraryTracks.filter((track) => track.name.toLowerCase().includes(librarySearch.toLowerCase()));
  const queuedTracks = queue.map((trackId) => libraryTracks.find((track) => track.id === trackId)).filter(Boolean);
  const nextQueuedTrack = queuedTracks[0];
  const audibleContributionA = channelVolumeA / 100 * channelGainA / 50 * Math.cos((crossfader / 100) * Math.PI / 2);
  const audibleContributionB = channelVolumeB / 100 * channelGainB / 50 * Math.sin((crossfader / 100) * Math.PI / 2);
  const recommendationSourceDeck = isPlayingA && isPlayingB
    ? audibleContributionA >= audibleContributionB ? 'A' : 'B'
    : isPlayingA ? 'A'
      : isPlayingB ? 'B'
        : deckA.audioUrl && deckB.audioUrl
          ? audibleContributionA >= audibleContributionB ? 'A' : 'B'
          : deckA.audioUrl ? 'A' : deckB.audioUrl ? 'B' : null;
  const recommendationSource = recommendationSourceDeck === 'A' ? deckA : recommendationSourceDeck === 'B' ? deckB : null;
  const recommendationSourceBpm = Number(recommendationSource?.bpm)
    * (recommendationSourceDeck === 'A' ? playbackRateA : playbackRateB);
  const recommendationTargetDeck = recommendationSourceDeck === 'A' ? 'B' : 'A';
  const recommendedTracks = recommendationSource && recommendationSourceBpm > 0
    ? libraryTracks
      .filter((track) => track.id !== deckA.libraryTrackId && track.id !== deckB.libraryTrackId)
      .map((track) => ({
        track,
        match: scoreTransitionCandidate(
          track,
          recommendationSourceBpm,
          recommendationSource.key,
          recommendationSource.energy,
        ),
      }))
      .filter((entry) => entry.match)
      .sort((first, second) => second.match.score - first.match.score)
      .slice(0, 5)
    : [];
  const selectedDeckBpm = Number(activeDeck === 'A' ? deckA.bpm : deckB.bpm);
  const otherDeckBpm = Number(activeDeck === 'A' ? deckB.bpm : deckA.bpm)
    * (activeDeck === 'A' ? playbackRateB : playbackRateA);
  const automaticTargetBpm = Number(nextQueuedTrack?.bpm) || otherDeckBpm;
  const transitionTargetBpm = tempoTransitionMode === 'MANUAL'
    ? Number(manualTargetBpm)
    : automaticTargetBpm;
  const selectedFx = fxTarget === 'MASTER'
    ? masterFx
    : fxTarget === 'A'
      ? { type: fxTypeA, depth: fxA, enabled: fxEnabledA, division: fxDivisionA }
      : { type: fxTypeB, depth: fxB, enabled: fxEnabledB, division: fxDivisionB };
  const updateSelectedFx = (updates) => {
    if (fxTarget === 'MASTER') setMasterFx((state) => ({ ...state, ...updates }));
    else if (fxTarget === 'A') {
      if (updates.type !== undefined) setFxTypeA(updates.type);
      if (updates.depth !== undefined) setFxA(updates.depth);
      if (updates.enabled !== undefined) setFxEnabledA(updates.enabled);
      if (updates.division !== undefined) setFxDivisionA(updates.division);
    } else {
      if (updates.type !== undefined) setFxTypeB(updates.type);
      if (updates.depth !== undefined) setFxB(updates.depth);
      if (updates.enabled !== undefined) setFxEnabledB(updates.enabled);
      if (updates.division !== undefined) setFxDivisionB(updates.division);
    }
  };

  const startTempoTransition = () => {
    const audio = activeDeck === 'A' ? audioARef.current : audioBRef.current;
    if (!audio || audio.paused || !(selectedDeckBpm > 0) || !(transitionTargetBpm > 0)) {
      setTempoTransitionStatus('PLAY THE ACTIVE DECK AND LOAD/QUEUE A TRACK WITH ANALYZED BPM');
      return;
    }
    const targetRate = transitionTargetBpm / selectedDeckBpm;
    if (targetRate < 0.5 || targetRate > 2) {
      setTempoTransitionStatus(`TARGET NEEDS AN UNSUPPORTED ${targetRate.toFixed(2)}× PLAYBACK RATE`);
      return;
    }
    if (syncCorrectionTimerRef.current?.referenceAudio !== audio) cancelSyncCorrection();
    const beatSeconds = 60 / selectedDeckBpm;
    const analysis = (activeDeck === 'A' ? deckA.analysis : deckB.analysis);
    const beatAnchor = analysis?.firstBeatTime ?? analysis?.beats?.[0] ?? 0;
    const nextBeat = beatAnchor
      + Math.ceil((audio.currentTime + 0.02 - beatAnchor) / beatSeconds) * beatSeconds;
    transitionTokenRef.current += 1;
    setTempoTransition({
      token: transitionTokenRef.current,
      deck: activeDeck,
      fromRate: audio.playbackRate,
      toRate: targetRate,
      targetBpm: transitionTargetBpm,
      nextBeat,
      baseBpm: selectedDeckBpm,
      bars: tempoTransitionBars,
    });
    setTempoTransitionStatus(`WAITING FOR NEXT BEAT · ${transitionTargetBpm.toFixed(1)} BPM OVER ${tempoTransitionBars} BARS`);
  };

  const cancelTempoTransition = () => {
    transitionTokenRef.current += 1;
    setTempoTransition(null);
    setTempoTransitionStatus('BPM TRANSITION STOPPED');
  };

  useEffect(() => {
    if (!tempoTransition) return undefined;
    const audio = tempoTransition.deck === 'A' ? audioARef.current : audioBRef.current;
    if (!audio) {
      setTempoTransitionStatus('BPM TRANSITION CANCELLED · DECK NOT AVAILABLE');
      setTempoTransition(null);
      return undefined;
    }

    let animationFrame;
    let startedAt = null;
    let lastAudioTime = audio.currentTime;
    let elapsedBeats = 0;
    let lastStateUpdate = 0;
    let lastRateUpdate = 0;
    const updateTransition = (now) => {
      if (tempoTransition.token !== transitionTokenRef.current) return;
      if (audio.paused) {
        setTempoTransitionStatus('BPM TRANSITION PAUSED WITH THE DECK');
        setTempoTransition(null);
        return;
      }
      if (startedAt === null && audio.currentTime >= tempoTransition.nextBeat) {
        startedAt = tempoTransition.nextBeat;
        elapsedBeats = Math.max(
          0,
          (audio.currentTime - tempoTransition.nextBeat) * tempoTransition.baseBpm / 60,
        );
        lastAudioTime = audio.currentTime;
      } else if (startedAt !== null) {
        elapsedBeats += Math.max(0, audio.currentTime - lastAudioTime) * tempoTransition.baseBpm / 60;
        lastAudioTime = audio.currentTime;
      }
      if (startedAt !== null) {
        const progress = Math.min(1, elapsedBeats / (tempoTransition.bars * 4));
        const playbackRate = tempoTransition.fromRate
          + (tempoTransition.toRate - tempoTransition.fromRate) * progress;
        if (now - lastRateUpdate >= 100 || progress === 1) {
          audio.playbackRate = playbackRate;
          (tempoTransition.deck === 'A' ? setPlaybackRateA : setPlaybackRateB)(playbackRate);
          lastRateUpdate = now;
        }
        if (now - lastStateUpdate >= 500 || progress === 1) {
          setTempoTransitionStatus(`BPM RAMP · ${(tempoTransition.baseBpm * playbackRate).toFixed(1)} → ${tempoTransition.targetBpm.toFixed(1)} BPM · ${Math.round(progress * 100)}%`);
          lastStateUpdate = now;
        }
        if (progress === 1) {
          setTempoTransition(null);
          setTempoTransitionStatus(`TEMPO MATCHED · ${tempoTransition.targetBpm.toFixed(1)} BPM`);
          return;
        }
      }
    };
    const animate = (now) => {
      updateTransition(now);
      if (tempoTransition.token === transitionTokenRef.current && !audio.paused) {
        animationFrame = requestAnimationFrame(animate);
      }
    };
    const handleMediaTimeUpdate = () => updateTransition(performance.now());
    const handlePlaybackPause = () => updateTransition(performance.now());
    audio.addEventListener('timeupdate', handleMediaTimeUpdate);
    audio.addEventListener('pause', handlePlaybackPause);
    audio.addEventListener('ended', handlePlaybackPause);
    animationFrame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(animationFrame);
      audio.removeEventListener('timeupdate', handleMediaTimeUpdate);
      audio.removeEventListener('pause', handlePlaybackPause);
      audio.removeEventListener('ended', handlePlaybackPause);
    };
  }, [tempoTransition]);

  return (
    <div className="app-shell min-h-screen bg-[#06070a] text-slate-100 p-4 font-mono select-none overflow-x-hidden">
      <audio
        ref={audioARef}
        src={deckA.audioUrl || undefined}
        preload="metadata"
        onLoadedMetadata={(event) => setDurationA(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => handleDeckTimeUpdate('A', event)}
        onRateChange={(event) => setPlaybackRateA(event.currentTarget.playbackRate)}
        onEnded={() => { cancelSyncCorrection(); setIsPlayingA(false); }}
        onPause={(event) => {
          setIsPlayingA(false);
          const sync = syncCorrectionTimerRef.current;
          if (sync?.audio === event.currentTarget || sync?.referenceAudio === event.currentTarget) cancelSyncCorrection();
        }}
      />
      <audio
        ref={audioBRef}
        src={deckB.audioUrl || undefined}
        preload="metadata"
        onLoadedMetadata={(event) => setDurationB(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => handleDeckTimeUpdate('B', event)}
        onRateChange={(event) => setPlaybackRateB(event.currentTarget.playbackRate)}
        onEnded={() => { cancelSyncCorrection(); setIsPlayingB(false); }}
        onPause={(event) => {
          setIsPlayingB(false);
          const sync = syncCorrectionTimerRef.current;
          if (sync?.audio === event.currentTarget || sync?.referenceAudio === event.currentTarget) cancelSyncCorrection();
        }}
      />
      <audio ref={cueAudioRef} className="cue-output-audio" aria-label="Headphone cue output" />
      {/* HEADER */}
      <header className="app-header flex items-center justify-between px-6 py-3 bg-[#0d0e15] border border-slate-800/80 rounded-2xl mb-4 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="brand-mark">
            <Disc className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="brand-title">
              NEXUS <span>INTELLIGENT DJ SYSTEM</span>
            </h1>
          </div>
        </div>

        <div className="app-header-meta">
          <MasterLevelMeter
            graphsRef={audioGraphsRef}
            clipped={masterClipped}
            clipRef={clipRef}
            onClip={() => setMasterClipped(true)}
            onReset={() => {
              clipRef.current = false;
              setMasterClipped(false);
            }}
          />
          <details className="shortcut-help">
            <summary><Keyboard aria-hidden="true" /> SHORTCUTS</summary>
            <div>
              <span><kbd>Space</kbd> Play active deck</span>
              <span><kbd>A</kbd> / <kbd>L</kbd> Play Deck A / B</span>
              <span><kbd>Q</kbd> / <kbd>P</kbd> Cue Deck A / B</span>
              <span><kbd>1–4</kbd> Trigger active deck cues</span>
              <span><kbd>S</kbd> / <kbd>K</kbd> Sync active / Deck B</span>
              <span><kbd>Z</kbd> / <kbd>X</kbd> and <kbd>N</kbd> / <kbd>M</kbd> Nudge A / B</span>
              <span><kbd>←</kbd> / <kbd>→</kbd> Fine phase · <kbd>↑</kbd> / <kbd>↓</kbd> Tempo</span>
              <span>Choose active deck in its header</span>
            </div>
          </details>
          <span className="system-indicator">
            <span className="system-dot" />
            LOCAL AUDIO WORKSTATION
          </span>
          <span className="system-version">2 DECKS <i /> STEREO</span>
        </div>
      </header>

      <section className="midi-panel" aria-label="MIDI controller setup">
        <div className="midi-panel-heading">
          <div>
            <Cable aria-hidden="true" />
            <h2 className="section-heading">MIDI CONTROLLER</h2>
            <span className="midi-status-dot" data-connected={midiInputs.length > 0} />
            <span className="midi-status">{midiStatus}</span>
          </div>
          <button type="button" className="control-button" onClick={requestMidiAccess}>
            {midiAccess ? 'REFRESH MIDI DEVICES' : 'CONNECT MIDI'}
          </button>
        </div>
        <div className="midi-learn-row">
          <label htmlFor="midi-action">LEARN CONTROL</label>
          <select id="midi-action" value={selectedMidiAction} onChange={(event) => setSelectedMidiAction(event.target.value)}>
            {MIDI_ACTIONS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
          </select>
          <button
            type="button"
            className={`control-button midi-learn-button ${isLearningMidi ? 'is-learning' : ''}`}
            onClick={isLearningMidi ? () => {
              learningActionRef.current = '';
              setIsLearningMidi(false);
              setMidiStatus(midiInputs.length ? `${midiInputs.length} MIDI INPUT${midiInputs.length === 1 ? '' : 'S'} READY` : 'MIDI LEARN CANCELLED');
            } : startMidiLearn}
            disabled={!midiAccess}
          >
            {isLearningMidi ? 'CANCEL LEARN' : midiMappings[selectedMidiAction] ? 'RELEARN CONTROL' : 'LEARN CONTROL'}
          </button>
          <button
            type="button"
            className="control-button midi-clear-button"
            onClick={clearMidiMapping}
            disabled={!midiMappings[selectedMidiAction]}
          >
            CLEAR
          </button>
        </div>
        <div className="midi-panel-footer">
          <span>
            {midiInputs.length
              ? `INPUTS · ${midiInputs.map(({ name }) => name).join(' / ')}`
              : 'USB / Bluetooth MIDI · allow browser access · select a target, then move a control to map it.'}
          </span>
          <span>{Object.keys(midiMappings).length} MAPPED</span>
        </div>
        {midiMappings[selectedMidiAction] && (
          <p className="midi-mapping-detail" role="status">
            {MIDI_ACTIONS.find(({ id }) => id === selectedMidiAction)?.label} · {midiMappings[selectedMidiAction].inputName} · CH {midiMappings[selectedMidiAction].channel + 1} · {midiMappings[selectedMidiAction].type.toUpperCase()} {midiMappings[selectedMidiAction].number}
          </p>
        )}
      </section>

      <section className="waveform-panel mb-4 rounded-2xl border border-slate-800 bg-[#0b0c13] p-4 shadow-xl">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AudioLines className="h-4 w-4 text-cyan-300" />
            <h2 className="section-heading">BEATMATCH DISPLAY <span>/</span> ANALYZED WAVEFORM</h2>
          </div>
          <span className={`rounded-md border px-2.5 py-1 text-[9px] font-black tracking-wider ${
            phaseLabel === 'ALIGNED' ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300' :
              phaseLabel === 'CLOSE' ? 'border-amber-500/40 bg-amber-950/30 text-amber-300' :
                phaseLabel === 'OFFSET' || phaseLabel === 'TEMPO MISMATCH' ? 'border-rose-500/40 bg-rose-950/30 text-rose-300' :
                'border-slate-700 bg-slate-900 text-slate-400'
          }`}>
            {phaseLabel}
            {hasBothTracks && ` · ${displayedBeatOffset > 0 ? '+' : ''}${displayedBeatOffset.toFixed(2)} BEAT`}
          </span>
        </div>
        <section
          className={`beat-alignment ${!hasBothTracks ? 'is-unavailable' : phaseLabel === 'ALIGNED' ? 'is-aligned' : phaseLabel === 'CLOSE' ? 'is-close' : 'is-offset'}`}
          aria-label="Beat alignment"
        >
          <div className="beat-alignment-readout">
            <div>
              <span className="beat-alignment-title">BEAT ALIGNMENT</span>
              <strong>{hasBothTracks ? phaseLabel : 'LOAD BOTH TRACKS'}</strong>
            </div>
            <div className="beat-alignment-values">
              {hasBothTracks ? (
                <>
                  <strong>{displayedBeatOffset > 0 ? '+' : ''}{displayedBeatOffset.toFixed(2)} BEAT</strong>
                  <span>{displayedBeatOffset === 0 ? '0 ms' : `${phaseOffsetMilliseconds > 0 ? '+' : ''}${phaseOffsetMilliseconds.toFixed(0)} ms`} · Δ {tempoGap.toFixed(1)} BPM</span>
                </>
              ) : <span>Phase offset appears after both analyzed decks are loaded.</span>}
            </div>
          </div>
          <div className="beat-alignment-lanes" aria-hidden="true">
            {[
              { deck: 'A', color: '#42d6b1', shift: 0 },
              { deck: 'B', color: '#b19aff', shift: -beatPhaseOffset * 25 },
            ].map(({ deck, color, shift }) => (
              <div className="beat-alignment-lane" key={deck}>
                <span style={{ color }}>DECK {deck}</span>
                <div className="beat-alignment-ruler">
                  <div className="beat-alignment-ticks" style={{ transform: `translateX(${shift}%)` }}>
                    {[1, 2, 3, 4, 1].map((beat, index) => (
                      <i className={beat === 1 ? 'is-bar' : ''} style={{ left: `${index * 25}%` }} key={`${beat}-${index}`}>
                        <b>{beat}</b>
                      </i>
                    ))}
                  </div>
                  <span className="beat-alignment-playhead" />
                </div>
              </div>
            ))}
          </div>
          {hasBothTracks && <div className="beat-alignment-bars">BAR / BEAT · A {barPositionA} <span>·</span> B {barPositionB}</div>}
        </section>
        <div className="grid-edit-toolbar" role="group" aria-label="Beat grid editing controls">
          <button type="button" aria-pressed={gridLocked} onClick={() => {
            const lockGrid = !gridLocked;
            setGridLocked(lockGrid);
            if (lockGrid) setGridEdit(false);
          }}>
            BEAT GRID {gridLocked ? 'LOCKED' : 'UNLOCKED'}
          </button>
          <button type="button" aria-pressed={gridEdit} disabled={gridLocked} onClick={() => setGridEdit((editing) => !editing)}>
            GRID EDIT {gridEdit ? 'ON' : 'OFF'}
          </button>
          <button type="button" aria-pressed={quantize} onClick={() => setQuantize((enabled) => !enabled)}>
            QUANTIZE {quantize ? 'ON' : 'OFF'}
          </button>
          {gridEdit && !gridLocked && <span>CLICK A WAVEFORM POSITION TO SET BEAT 1</span>}
        </div>
        <AnalyzedWaveforms
          audioARef={audioARef}
          audioBRef={audioBRef}
          tracks={{
            A: { audioRef: audioARef, analysis: deckA.analysis, bpm: bpmValueA, playbackRate: playbackRateA, cues: cuesA, loading: deckA.loading, loop: loops.A ? { start: loops.A.start, end: loops.A.start + loops.A.beats * 60 / Math.max(1, bpmValueA) } : null },
            B: { audioRef: audioBRef, analysis: deckB.analysis, bpm: bpmValueB, playbackRate: playbackRateB, cues: cuesB, loading: deckB.loading, loop: loops.B ? { start: loops.B.start, end: loops.B.start + loops.B.beats * 60 / Math.max(1, bpmValueB) } : null },
          }}
          onSeek={seekDeck}
          gridEdit={gridEdit}
          gridLocked={gridLocked}
          onSetBeatOne={setBeatOne}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="waveform-note">Scrolling 8-bar view · centered playhead · analyzed beat grids · click a lane to cue/seek, scroll or use +/− to zoom.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => syncDeckToOther('A')}
              disabled={!deckA.audioUrl || !deckB.audioUrl}
              className="control-button sync-button inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-[9px] font-black tracking-wider text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Link2 className="h-3 w-3" /> SYNC A TO B
            </button>
            <button
              type="button"
              onClick={() => syncDeckToOther('B')}
              disabled={!deckA.audioUrl || !deckB.audioUrl}
              className="control-button sync-button inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-[9px] font-black tracking-wider text-purple-200 transition hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Link2 className="h-3 w-3" /> SYNC B TO A
            </button>
          </div>
        </div>
        {syncMessage && <p role="status" className="mt-2 text-[10px] text-cyan-200">{syncMessage}</p>}
      </section>

      {/* DUAL DECKS MAIN CONSOLE */}
      <div className="deck-console grid grid-cols-1 lg:grid-cols-12 gap-4 mb-4">
        
        {/* DECK A */}
        <div className="deck-panel deck-a lg:col-span-4 bg-[#0b0c13] border border-cyan-500/30 rounded-2xl p-5 relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <span className="deck-label">
              <i /> DECK A
            </span>
            <button
              type="button"
              aria-pressed={activeDeck === 'A'}
              className={`deck-active-toggle ${activeDeck === 'A' ? 'is-active' : ''}`}
              onClick={(event) => { setActiveDeck('A'); event.currentTarget.blur(); }}
              title="Set Deck A as the keyboard-control target"
            >
              {activeDeck === 'A' ? 'ACTIVE DECK' : 'SET ACTIVE'}
            </button>
            <button
              type="button"
              className="deck-sync-button"
              onClick={() => syncDeckToOther('A')}
              disabled={!deckA.audioUrl || !deckB.audioUrl || !(bpmValueA > 0) || !(bpmValueB > 0)}
              title="Match Deck A to Deck B's current tempo and beat phase"
            >
              <Link2 aria-hidden="true" /> SYNC TO B
            </button>
            <label className="control-button load-button flex items-center gap-1.5 text-[11px] font-bold bg-slate-900 hover:bg-slate-800 text-cyan-300 px-3 py-1.5 rounded-lg border border-cyan-500/30 cursor-pointer transition">
              <Upload className="w-3.5 h-3.5" />
              LOAD TRACK
              <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleFileUpload(e, 'A')} />
            </label>
          </div>

          <div className="track-display bg-[#121420] border border-slate-800 p-3 rounded-xl mb-4">
            <div className="track-identity">
              <div className="track-artwork track-artwork-a"><Disc aria-hidden="true" /></div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-100 truncate">
                  {deckA.loading ? <span className="text-cyan-400 animate-pulse">ANALYZING TRACK...</span> : deckA.name}
                </p>
                <p className="track-artist">{deckA.artist || 'LOCAL FILE'} · {deckA.analysis?.duration ? formatTime(deckA.analysis.duration) : '—:—'}</p>
              </div>
            </div>
            <TrackOverviewWaveform
              analysis={deckA.analysis}
              duration={durationA}
              position={positionA}
              color="#42d6b1"
              label="Deck A"
              onSeek={(time) => seekDeck('A', time)}
            />
          </div>
          {deckA.error && <p role="alert" className="text-xs text-amber-300 mb-3">{deckA.error}</p>}
          <div className="grid-correction-controls">
            <label>GRID BPM
              <input
                key={`grid-a-${deckA.libraryTrackId}-${deckA.bpm}`}
                type="number"
                min="40"
                max="240"
                step="0.1"
                defaultValue={bpmValueA > 0 ? bpmValueA : ''}
                disabled={!deckA.audioUrl || gridLocked || !gridEdit}
                onBlur={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (value > 0 && value !== bpmValueA) correctDeckBpm('A', value);
                }}
                aria-label="Correct Deck A grid BPM"
              />
            </label>
            <button type="button" disabled={!deckA.audioUrl || gridLocked || !gridEdit || !(bpmValueA > 0)} onClick={() => correctDeckBpm('A', Math.min(240, bpmValueA * 2))}>×2</button>
            <button type="button" disabled={!deckA.audioUrl || gridLocked || !gridEdit || !(bpmValueA > 0)} onClick={() => correctDeckBpm('A', Math.max(40, bpmValueA / 2))}>÷2</button>
            <button type="button" disabled={!deckA.audioUrl || gridLocked || !gridEdit} onClick={() => setBeatOne('A', audioARef.current?.currentTime || 0)}>SET BEAT 1</button>
          </div>

          <div className="transport-seek mb-4 rounded-xl border border-slate-800 bg-[#10121b] px-3 py-2">
            <div className="mb-1 flex justify-between text-[10px] tabular-nums text-slate-400">
              <span>{formatTime(positionA)}</span>
              <span>−{formatTime(Math.max(0, durationA - positionA))}</span>
              <span>{formatTime(durationA)}</span>
            </div>
            <input
              aria-label="Deck A track position"
              type="range"
              min="0"
              max={durationA || 1}
              step="0.1"
              value={Math.min(positionA, durationA || 0)}
              disabled={!deckA.audioUrl || !durationA}
              onChange={(event) => seekDeck('A', Number(event.target.value))}
              className="h-1.5 w-full cursor-pointer accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </div>

          <div className="deck-performance-controls">
            <JogWheel deck="A" position={positionA} playing={isPlayingA} onSeek={(seconds) => seekDeck('A', seconds)} duration={durationA} />
            <div className="pitch-control">
              <div className="pitch-heading">
                <label htmlFor="pitch-a">PITCH / TEMPO</label>
                <select aria-label="Deck A pitch range" value={pitchRangeA} onChange={(event) => setPitchRangeA(Number(event.target.value))}>
                  {[6, 8, 10, 16].map((range) => <option key={range} value={range}>±{range}%</option>)}
                </select>
              </div>
              <input
                id="pitch-a"
                aria-label="Deck A pitch fader"
                type="range"
                min={1 - pitchRangeA / 100}
                max={1 + pitchRangeA / 100}
                step="0.0001"
                value={Math.min(1 + pitchRangeA / 100, Math.max(1 - pitchRangeA / 100, playbackRateA))}
                disabled={!deckA.audioUrl}
                onChange={(event) => { const rate = Number(event.target.value); cancelSyncCorrection(); if (audioARef.current) audioARef.current.playbackRate = rate; }}
              />
              <output>{deckA.bpm === '--' ? '--.-' : (bpmValueA * playbackRateA).toFixed(1)} BPM</output>
              <div className="deck-transport-row">
                <button type="button" className="deck-cue-button" disabled={!deckA.audioUrl} onClick={() => cueDeck('A')}>CUE</button>
                <button type="button" className={`deck-cue-monitor ${cueA ? 'is-on' : ''}`} aria-pressed={cueA} disabled={!cueOutput} onClick={() => setCueA(!cueA)} title={cueOutput ? 'Toggle Deck A headphone monitoring' : cueOutputStatus}>PHONES</button>
                <button type="button" className="deck-nudge-button" disabled={!deckA.audioUrl} onClick={() => nudgeDeck('A', -0.1)}>NUDGE −</button>
                <button type="button" className="deck-nudge-button" disabled={!deckA.audioUrl} onClick={() => nudgeDeck('A', 0.1)}>NUDGE +</button>
              </div>
            </div>
          </div>

          <div className="metric-strip grid grid-cols-3 gap-2 mb-6">
            <div className="metric-cell bg-[#121420] p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-500 block">TEMPO</span>
              <span className="text-2xl font-black text-cyan-400">{deckA.bpm === '--' ? '--.-' : (bpmValueA * playbackRateA).toFixed(1)}</span>
              <span className="block text-[9px] font-bold text-slate-500">{playbackRateA.toFixed(2)}× RATE</span>
            </div>
            <div className="metric-cell bg-[#121420] p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-500 block">CAMELOT</span>
              <span className="text-2xl font-black text-teal-300">{deckA.key}</span>
            </div>
            <div className="metric-cell bg-[#121420] p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-500 block">ENERGY</span>
              <span className="text-2xl font-black text-amber-400">{deckA.energy}/10</span>
            </div>
          </div>

          <section className="channel-strip mb-3 rounded-xl border border-slate-800 bg-[#10121b] p-3">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[9px] font-black tracking-[0.16em] text-slate-400">CHANNEL EQ / PERFORMANCE FX</span>
              <button
                type="button"
                aria-pressed={fxEnabledA}
                onClick={() => {
                  if (!fxEnabledA && fxA === 0) setFxA(35);
                  setFxEnabledA(!fxEnabledA);
                }}
                className={`rounded-md border px-2 py-1 text-[9px] font-black tracking-wider transition ${
                  fxEnabledA ? 'border-cyan-400/60 bg-cyan-400/15 text-cyan-300' : 'border-slate-700 text-slate-500 hover:text-slate-300'
                }`}
              >
                {FX_OPTIONS.find(({ id }) => id === fxTypeA)?.label} {fxEnabledA ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="mb-3 grid grid-cols-[1fr_auto] items-center gap-2">
              <select
                aria-label="Deck A effect"
                value={fxTypeA}
                onChange={(event) => {
                  setFxTypeA(event.target.value);
                  setFxA((value) => value || 35);
                  setFxEnabledA(true);
                }}
                className="min-w-0 rounded-md border border-slate-700 bg-[#191c27] px-2 py-1.5 text-[10px] font-bold text-slate-200 outline-none focus:border-cyan-400"
              >
                {FX_OPTIONS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
              <MixerKnob
                label="TIME"
                ariaLabel="Deck A FX time division"
                value={(TIME_DIVISIONS.findIndex(({ beats }) => beats === fxDivisionA) / (TIME_DIVISIONS.length - 1)) * 100}
                onChange={(value) => setFxDivisionA(TIME_DIVISIONS[Math.round((value / 100) * (TIME_DIVISIONS.length - 1))].beats)}
                display={TIME_DIVISIONS.find(({ beats }) => beats === fxDivisionA)?.label || '1/2'}
                accent="#22d3ee"
                step={100 / (TIME_DIVISIONS.length - 1)}
              />
            </div>
            <div className="grid grid-cols-4 gap-1">
              <MixerKnob label="LOW" value={eqA.low} accent="#22d3ee" display={`${Math.round((eqA.low - 50) * 0.24)} dB`} onChange={(value) => setEqA((eq) => ({ ...eq, low: value }))} />
              <MixerKnob label="MID" value={eqA.mid} accent="#22d3ee" display={`${Math.round((eqA.mid - 50) * 0.24)} dB`} onChange={(value) => setEqA((eq) => ({ ...eq, mid: value }))} />
              <MixerKnob label="HIGH" value={eqA.high} accent="#22d3ee" display={`${Math.round((eqA.high - 50) * 0.24)} dB`} onChange={(value) => setEqA((eq) => ({ ...eq, high: value }))} />
              <MixerKnob label="FX DEPTH" value={fxA} accent="#a78bfa" display={`${fxA}%`} onChange={(value) => { setFxA(value); setFxEnabledA(value > 0); }} />
            </div>
          </section>

          <BeatLoopControls deck="A" loop={loops.A} selectedBeats={loopLengths.A} onLengthChange={changeLoopLength} onToggle={toggleBeatLoop} status={loopStatus} disabled={!deckA.audioUrl} />

          <section className="cue-strip mb-4 rounded-xl border border-slate-800 bg-[#10121b] p-3">
            <div className="mb-2 flex items-center gap-2 text-[9px] font-black tracking-[0.16em] text-slate-400">
              <Headphones className="h-3.5 w-3.5 text-cyan-400" />
              PERFORMANCE CUES
              <span className="ml-auto font-normal tracking-normal text-slate-600">tap empty pad while playing to set</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {cuesA.map((cue, index) => (
                <div key={`A-${index}`} className="relative">
                  <button
                    type="button"
                    disabled={!deckA.audioUrl}
                    onClick={() => triggerHotCue('A', index)}
                    className={`cue-pad flex aspect-square w-full flex-col items-center justify-center rounded-lg border text-[9px] font-black tracking-wider transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 ${
                      cue === null
                        ? 'border-slate-700 bg-[#191c27] text-slate-500 hover:border-cyan-500/60 hover:text-cyan-300'
                        : 'border-cyan-400/60 bg-cyan-400/15 text-cyan-200 shadow-[inset_0_0_18px_rgba(34,211,238,0.08)]'
                    }`}
                  >
                    <span className="text-xs">{String(index + 1).padStart(2, '0')}</span>
                    <span>{cue === null ? 'SET CUE' : formatTime(cue)}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Set deck A hot cue ${index + 1}`}
                    title="Store cue at current play position"
                    disabled={!deckA.audioUrl}
                    onClick={() => setHotCue('A', index)}
                    className="absolute right-1 top-1 rounded p-0.5 text-slate-500 hover:text-cyan-300 disabled:opacity-30"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <button
            onClick={() => togglePlayback('A')}
            disabled={!deckA.audioUrl}
            className={`transport-play w-full py-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition disabled:cursor-not-allowed disabled:opacity-40 ${
              isPlayingA ? 'bg-amber-400 text-slate-950' : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
            }`}
          >
            {isPlayingA ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
            {isPlayingA ? 'PAUSE' : deckA.audioUrl ? 'PLAY' : 'LOAD TRACK TO PLAY'}
          </button>
        </div>

        {/* MASTER MIXER */}
        <div className="mixer-panel lg:col-span-4 bg-[#0b0c13] border border-slate-800/80 rounded-2xl p-3">
          <div className="mixer-heading">
            <div><Sliders aria-hidden="true" /><span>4-CHANNEL PERFORMANCE MIXER</span></div>
            <div className="master-output-control">
              <label htmlFor="master-volume">MASTER</label>
              <input id="master-volume" aria-label="Master volume" type="range" min="0" max="100" value={masterVolume} onChange={(event) => setMasterVolume(Number(event.target.value))} />
              <output>{masterVolume}%</output>
              <button type="button" className={`headphone-output-button ${cueOutput ? 'is-selected' : ''}`} onClick={selectCueOutput} title={cueOutputStatus}>{cueOutput ? 'PHONES ✓' : 'PHONES'}</button>
            </div>
          </div>
          <div className="mixer-channels">
            {[
              { deck: 'A', color: '#22d3ee', eq: eqA, setEq: setEqA, gain: channelGainA, setGain: setChannelGainA, volume: channelVolumeA, setVolume: setChannelVolumeA, filter: channelFilterA, setFilter: setChannelFilterA, cue: cueA, setCue: setCueA, loaded: Boolean(deckA.audioUrl), tempo: deckA.bpm === '--' ? '--.-' : (bpmValueA * playbackRateA).toFixed(1) },
              { deck: 'B', color: '#c084fc', eq: eqB, setEq: setEqB, gain: channelGainB, setGain: setChannelGainB, volume: channelVolumeB, setVolume: setChannelVolumeB, filter: channelFilterB, setFilter: setChannelFilterB, cue: cueB, setCue: setCueB, loaded: Boolean(deckB.audioUrl), tempo: deckB.bpm === '--' ? '--.-' : (bpmValueB * playbackRateB).toFixed(1) },
            ].map((channel) => (
              <section className={`mixer-channel mixer-channel-${channel.deck.toLowerCase()}`} key={channel.deck} aria-label={`Deck ${channel.deck} mixer channel`}>
                <div className="mixer-channel-header"><b style={{ color: channel.color }}>CH {channel.deck}</b><span>{channel.tempo} BPM</span></div>
                <div className="mixer-knobs">
                  <MixerKnob label="TRIM" value={channel.gain} accent={channel.color} display={`${(channel.gain / 50).toFixed(1)}×`} onChange={channel.setGain} />
                  <MixerKnob label="HI" value={channel.eq.high} accent={channel.color} display={`${Math.round((channel.eq.high - 50) * 0.24)} dB`} onChange={(value) => channel.setEq((eq) => ({ ...eq, high: value }))} />
                  <MixerKnob label="MID" value={channel.eq.mid} accent={channel.color} display={`${Math.round((channel.eq.mid - 50) * 0.24)} dB`} onChange={(value) => channel.setEq((eq) => ({ ...eq, mid: value }))} />
                  <MixerKnob label="LOW" value={channel.eq.low} accent={channel.color} display={`${Math.round((channel.eq.low - 50) * 0.24)} dB`} onChange={(value) => channel.setEq((eq) => ({ ...eq, low: value }))} />
                  <MixerKnob label="FILTER" value={channel.filter} accent={channel.color} display={`${Math.round(channel.filter)}%`} onChange={channel.setFilter} />
                </div>
                <div className="mixer-channel-bottom">
                  <ChannelLevelMeter graphsRef={audioGraphsRef} deck={channel.deck} />
                  <input
                    aria-label={`Deck ${channel.deck} channel fader`}
                    className="channel-fader"
                    type="range"
                    min="0"
                    max="100"
                    value={channel.volume}
                    disabled={!channel.loaded}
                    onChange={(event) => channel.setVolume(Number(event.target.value))}
                  />
                  <div className="channel-bottom-actions">
                    <output>{channel.volume}</output>
                    <button type="button" aria-pressed={channel.cue} disabled={!cueOutput || !channel.loaded} onClick={() => channel.setCue(!channel.cue)} title={cueOutput ? `Toggle Deck ${channel.deck} headphone cue` : cueOutputStatus}>CUE</button>
                  </div>
                </div>
              </section>
            ))}
          </div>
          <div className="crossfader-control">
            <div><span>DECK A</span><label htmlFor="crossfader">CROSSFADER</label><span>DECK B</span></div>
            <input id="crossfader" aria-label="Crossfader" type="range" min="0" max="100" value={crossfader} onChange={(event) => handleCrossfaderChange(Number(event.target.value))} />
            <div className="crossfader-ticks"><i /><i /><i /><i /><i /></div>
          </div>
          <section className="central-fx" aria-label="Central effects">
            <div className="central-fx-heading"><span>MASTER FX</span><button type="button" aria-pressed={selectedFx.enabled} className={selectedFx.enabled ? 'fx-active' : ''} onClick={() => {
              if (!selectedFx.enabled && selectedFx.depth === 0) updateSelectedFx({ depth: 35 });
              updateSelectedFx({ enabled: !selectedFx.enabled });
            }}>{selectedFx.enabled ? 'ON' : 'OFF'}</button></div>
            <div className="fx-target-selector" role="group" aria-label="FX target">
              {[['A', 'DECK A'], ['MASTER', 'MASTER'], ['B', 'DECK B']].map(([target, label]) => <button type="button" key={target} aria-pressed={fxTarget === target} className={fxTarget === target ? 'is-selected' : ''} onClick={() => setFxTarget(target)}>{label}</button>)}
            </div>
            <div className="central-fx-controls">
              <select aria-label="Effect type" value={selectedFx.type} onChange={(event) => updateSelectedFx({ type: event.target.value, enabled: true, depth: selectedFx.depth || 35 })}>
                {FX_OPTIONS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
              <MixerKnob label="DEPTH" value={selectedFx.depth} accent="#fbbf24" display={`${selectedFx.depth}%`} onChange={(value) => updateSelectedFx({ depth: value, enabled: value > 0 })} />
              <MixerKnob label="BEAT" value={(TIME_DIVISIONS.findIndex(({ beats }) => beats === selectedFx.division) / (TIME_DIVISIONS.length - 1)) * 100} accent="#fbbf24" display={TIME_DIVISIONS.find(({ beats }) => beats === selectedFx.division)?.label || '1/2'} onChange={(value) => updateSelectedFx({ division: TIME_DIVISIONS[Math.round((value / 100) * (TIME_DIVISIONS.length - 1))].beats })} step={100 / (TIME_DIVISIONS.length - 1)} />
            </div>
            <p className="fx-routing-note">{fxTarget === 'MASTER' ? 'FX ROUTED TO STEREO MASTER BUS' : `FX ROUTED TO DECK ${fxTarget}`}</p>
          </section>
          <section className="tempo-transition-controls" aria-label="BPM transition">
            <div className="tempo-transition-heading"><span>BPM TRANSITION</span><span>{tempoTransitionStatus}</span></div>
            <div className="tempo-transition-row">
              <select aria-label="BPM transition mode" value={tempoTransitionMode} onChange={(event) => { setTempoTransitionMode(event.target.value); if (event.target.value === 'OFF' && tempoTransition) cancelTempoTransition(); }}><option value="OFF">OFF</option><option value="AUTO">AUTO</option><option value="MANUAL">MANUAL</option></select>
              {tempoTransitionMode === 'MANUAL' && <input aria-label="Manual target BPM" type="number" min="40" max="240" step="0.1" value={manualTargetBpm} onChange={(event) => setManualTargetBpm(event.target.value)} />}
              <select aria-label="BPM transition duration" value={tempoTransitionBars} onChange={(event) => setTempoTransitionBars(Number(event.target.value))}>{[4, 8, 16, 32].map((bars) => <option key={bars} value={bars}>{bars} BARS</option>)}</select>
              <button type="button" onClick={tempoTransition ? cancelTempoTransition : startTempoTransition} disabled={tempoTransitionMode === 'OFF' || (tempoTransitionMode !== 'MANUAL' && !(transitionTargetBpm > 0))}>{tempoTransition ? 'CANCEL' : `MATCH ${transitionTargetBpm > 0 ? `${transitionTargetBpm.toFixed(1)} BPM` : ''}`}</button>
            </div>
          </section>
        </div>

        {/* DECK B */}
        <div className="deck-panel deck-b lg:col-span-4 bg-[#0b0c13] border border-purple-500/30 rounded-2xl p-5 relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <span className="deck-label">
              <i /> DECK B
            </span>
            <button
              type="button"
              aria-pressed={activeDeck === 'B'}
              className={`deck-active-toggle ${activeDeck === 'B' ? 'is-active' : ''}`}
              onClick={(event) => { setActiveDeck('B'); event.currentTarget.blur(); }}
              title="Set Deck B as the keyboard-control target"
            >
              {activeDeck === 'B' ? 'ACTIVE DECK' : 'SET ACTIVE'}
            </button>
            <button
              type="button"
              className="deck-sync-button"
              onClick={() => syncDeckToOther('B')}
              disabled={!deckA.audioUrl || !deckB.audioUrl || !(bpmValueA > 0) || !(bpmValueB > 0)}
              title="Match Deck B to Deck A's current tempo and beat phase"
            >
              <Link2 aria-hidden="true" /> SYNC TO A
            </button>
            <label className="control-button load-button flex items-center gap-1.5 text-[11px] font-bold bg-slate-900 hover:bg-slate-800 text-purple-300 px-3 py-1.5 rounded-lg border border-purple-500/30 cursor-pointer transition">
              <Upload className="w-3.5 h-3.5" />
              LOAD TRACK
              <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleFileUpload(e, 'B')} />
            </label>
          </div>

          <div className="track-display bg-[#121420] border border-slate-800 p-3 rounded-xl mb-4">
            <div className="track-identity">
              <div className="track-artwork track-artwork-b"><Disc aria-hidden="true" /></div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-100 truncate">
                  {deckB.loading ? <span className="text-purple-400 animate-pulse">ANALYZING TRACK...</span> : deckB.name}
                </p>
                <p className="track-artist">{deckB.artist || 'LOCAL FILE'} · {deckB.analysis?.duration ? formatTime(deckB.analysis.duration) : '—:—'}</p>
              </div>
            </div>
            <TrackOverviewWaveform
              analysis={deckB.analysis}
              duration={durationB}
              position={positionB}
              color="#b19aff"
              label="Deck B"
              onSeek={(time) => seekDeck('B', time)}
            />
          </div>
          {deckB.error && <p role="alert" className="text-xs text-amber-300 mb-3">{deckB.error}</p>}
          <div className="grid-correction-controls">
            <label>GRID BPM
              <input
                key={`grid-b-${deckB.libraryTrackId}-${deckB.bpm}`}
                type="number"
                min="40"
                max="240"
                step="0.1"
                defaultValue={bpmValueB > 0 ? bpmValueB : ''}
                disabled={!deckB.audioUrl || gridLocked || !gridEdit}
                onBlur={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (value > 0 && value !== bpmValueB) correctDeckBpm('B', value);
                }}
                aria-label="Correct Deck B grid BPM"
              />
            </label>
            <button type="button" disabled={!deckB.audioUrl || gridLocked || !gridEdit || !(bpmValueB > 0)} onClick={() => correctDeckBpm('B', Math.min(240, bpmValueB * 2))}>×2</button>
            <button type="button" disabled={!deckB.audioUrl || gridLocked || !gridEdit || !(bpmValueB > 0)} onClick={() => correctDeckBpm('B', Math.max(40, bpmValueB / 2))}>÷2</button>
            <button type="button" disabled={!deckB.audioUrl || gridLocked || !gridEdit} onClick={() => setBeatOne('B', audioBRef.current?.currentTime || 0)}>SET BEAT 1</button>
          </div>

          <div className="transport-seek mb-4 rounded-xl border border-slate-800 bg-[#10121b] px-3 py-2">
            <div className="mb-1 flex justify-between text-[10px] tabular-nums text-slate-400">
              <span>{formatTime(positionB)}</span>
              <span>−{formatTime(Math.max(0, durationB - positionB))}</span>
              <span>{formatTime(durationB)}</span>
            </div>
            <input
              aria-label="Deck B track position"
              type="range"
              min="0"
              max={durationB || 1}
              step="0.1"
              value={Math.min(positionB, durationB || 0)}
              disabled={!deckB.audioUrl || !durationB}
              onChange={(event) => seekDeck('B', Number(event.target.value))}
              className="h-1.5 w-full cursor-pointer accent-purple-400 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </div>

          <div className="deck-performance-controls">
            <JogWheel deck="B" position={positionB} playing={isPlayingB} onSeek={(seconds) => seekDeck('B', seconds)} duration={durationB} />
            <div className="pitch-control">
              <div className="pitch-heading">
                <label htmlFor="pitch-b">PITCH / TEMPO</label>
                <select aria-label="Deck B pitch range" value={pitchRangeB} onChange={(event) => setPitchRangeB(Number(event.target.value))}>
                  {[6, 8, 10, 16].map((range) => <option key={range} value={range}>±{range}%</option>)}
                </select>
              </div>
              <input
                id="pitch-b"
                aria-label="Deck B pitch fader"
                type="range"
                min={1 - pitchRangeB / 100}
                max={1 + pitchRangeB / 100}
                step="0.0001"
                value={Math.min(1 + pitchRangeB / 100, Math.max(1 - pitchRangeB / 100, playbackRateB))}
                disabled={!deckB.audioUrl}
                onChange={(event) => { const rate = Number(event.target.value); cancelSyncCorrection(); if (audioBRef.current) audioBRef.current.playbackRate = rate; }}
              />
              <output>{deckB.bpm === '--' ? '--.-' : (bpmValueB * playbackRateB).toFixed(1)} BPM</output>
              <div className="deck-transport-row">
                <button type="button" className="deck-cue-button" disabled={!deckB.audioUrl} onClick={() => cueDeck('B')}>CUE</button>
                <button type="button" className={`deck-cue-monitor ${cueB ? 'is-on' : ''}`} aria-pressed={cueB} disabled={!cueOutput} onClick={() => setCueB(!cueB)} title={cueOutput ? 'Toggle Deck B headphone monitoring' : cueOutputStatus}>PHONES</button>
                <button type="button" className="deck-nudge-button" disabled={!deckB.audioUrl} onClick={() => nudgeDeck('B', -0.1)}>NUDGE −</button>
                <button type="button" className="deck-nudge-button" disabled={!deckB.audioUrl} onClick={() => nudgeDeck('B', 0.1)}>NUDGE +</button>
              </div>
            </div>
          </div>

          <div className="metric-strip grid grid-cols-3 gap-2 mb-6">
            <div className="metric-cell bg-[#121420] p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-500 block">TEMPO</span>
              <span className="text-2xl font-black text-purple-400">{deckB.bpm === '--' ? '--.-' : (bpmValueB * playbackRateB).toFixed(1)}</span>
              <span className="block text-[9px] font-bold text-slate-500">{playbackRateB.toFixed(2)}× RATE</span>
            </div>
            <div className="metric-cell bg-[#121420] p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-500 block">CAMELOT</span>
              <span className="text-2xl font-black text-pink-400">{deckB.key}</span>
            </div>
            <div className="metric-cell bg-[#121420] p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-500 block">ENERGY</span>
              <span className="text-2xl font-black text-amber-400">{deckB.energy}/10</span>
            </div>
          </div>

          <section className="channel-strip mb-3 rounded-xl border border-slate-800 bg-[#10121b] p-3">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[9px] font-black tracking-[0.16em] text-slate-400">CHANNEL EQ / PERFORMANCE FX</span>
              <button
                type="button"
                aria-pressed={fxEnabledB}
                onClick={() => {
                  if (!fxEnabledB && fxB === 0) setFxB(35);
                  setFxEnabledB(!fxEnabledB);
                }}
                className={`rounded-md border px-2 py-1 text-[9px] font-black tracking-wider transition ${
                  fxEnabledB ? 'border-purple-400/60 bg-purple-400/15 text-purple-300' : 'border-slate-700 text-slate-500 hover:text-slate-300'
                }`}
              >
                {FX_OPTIONS.find(({ id }) => id === fxTypeB)?.label} {fxEnabledB ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="mb-3 grid grid-cols-[1fr_auto] items-center gap-2">
              <select
                aria-label="Deck B effect"
                value={fxTypeB}
                onChange={(event) => {
                  setFxTypeB(event.target.value);
                  setFxB((value) => value || 35);
                  setFxEnabledB(true);
                }}
                className="min-w-0 rounded-md border border-slate-700 bg-[#191c27] px-2 py-1.5 text-[10px] font-bold text-slate-200 outline-none focus:border-purple-400"
              >
                {FX_OPTIONS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
              <MixerKnob
                label="TIME"
                ariaLabel="Deck B FX time division"
                value={(TIME_DIVISIONS.findIndex(({ beats }) => beats === fxDivisionB) / (TIME_DIVISIONS.length - 1)) * 100}
                onChange={(value) => setFxDivisionB(TIME_DIVISIONS[Math.round((value / 100) * (TIME_DIVISIONS.length - 1))].beats)}
                display={TIME_DIVISIONS.find(({ beats }) => beats === fxDivisionB)?.label || '1/2'}
                accent="#c084fc"
                step={100 / (TIME_DIVISIONS.length - 1)}
              />
            </div>
            <div className="grid grid-cols-4 gap-1">
              <MixerKnob label="LOW" value={eqB.low} accent="#c084fc" display={`${Math.round((eqB.low - 50) * 0.24)} dB`} onChange={(value) => setEqB((eq) => ({ ...eq, low: value }))} />
              <MixerKnob label="MID" value={eqB.mid} accent="#c084fc" display={`${Math.round((eqB.mid - 50) * 0.24)} dB`} onChange={(value) => setEqB((eq) => ({ ...eq, mid: value }))} />
              <MixerKnob label="HIGH" value={eqB.high} accent="#c084fc" display={`${Math.round((eqB.high - 50) * 0.24)} dB`} onChange={(value) => setEqB((eq) => ({ ...eq, high: value }))} />
              <MixerKnob label="FX DEPTH" value={fxB} accent="#a78bfa" display={`${fxB}%`} onChange={(value) => { setFxB(value); setFxEnabledB(value > 0); }} />
            </div>
          </section>

          <BeatLoopControls deck="B" loop={loops.B} selectedBeats={loopLengths.B} onLengthChange={changeLoopLength} onToggle={toggleBeatLoop} status={loopStatus} disabled={!deckB.audioUrl} />

          <section className="cue-strip mb-4 rounded-xl border border-slate-800 bg-[#10121b] p-3">
            <div className="mb-2 flex items-center gap-2 text-[9px] font-black tracking-[0.16em] text-slate-400">
              <Headphones className="h-3.5 w-3.5 text-purple-400" />
              PERFORMANCE CUES
              <span className="ml-auto font-normal tracking-normal text-slate-600">tap empty pad while playing to set</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {cuesB.map((cue, index) => (
                <div key={`B-${index}`} className="relative">
                  <button
                    type="button"
                    disabled={!deckB.audioUrl}
                    onClick={() => triggerHotCue('B', index)}
                    className={`cue-pad flex aspect-square w-full flex-col items-center justify-center rounded-lg border text-[9px] font-black tracking-wider transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 ${
                      cue === null
                        ? 'border-slate-700 bg-[#191c27] text-slate-500 hover:border-purple-500/60 hover:text-purple-300'
                        : 'border-purple-400/60 bg-purple-400/15 text-purple-200 shadow-[inset_0_0_18px_rgba(192,132,252,0.08)]'
                    }`}
                  >
                    <span className="text-xs">{String(index + 1).padStart(2, '0')}</span>
                    <span>{cue === null ? 'SET CUE' : formatTime(cue)}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Set deck B hot cue ${index + 1}`}
                    title="Store cue at current play position"
                    disabled={!deckB.audioUrl}
                    onClick={() => setHotCue('B', index)}
                    className="absolute right-1 top-1 rounded p-0.5 text-slate-500 hover:text-purple-300 disabled:opacity-30"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <button
            onClick={() => togglePlayback('B')}
            disabled={!deckB.audioUrl}
            className={`transport-play w-full py-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition disabled:cursor-not-allowed disabled:opacity-40 ${
              isPlayingB ? 'bg-amber-400 text-slate-950' : 'bg-purple-500 text-slate-950 hover:bg-purple-400'
            }`}
          >
            {isPlayingB ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
            {isPlayingB ? 'PAUSE' : deckB.audioUrl ? 'PLAY' : 'LOAD TRACK TO PLAY'}
          </button>
        </div>
      </div>

      <section className="library-panel" aria-label="Local track library and queue">
        <div className="library-header">
          <div>
            <span className="library-kicker"><ListMusic aria-hidden="true" /> COLLECTION / PLAY QUEUE</span>
            <h2>TRACK LIBRARY</h2>
            <p>Audio and analysis stay in this browser. Analyze the collection while both decks are paused.</p>
          </div>
          <div className="library-header-actions">
            <button
              type="button"
              className="library-analyze"
              onClick={() => void analyzeLibrary()}
              disabled={libraryAnalyzing || isPlayingA || isPlayingB || libraryTracks.length === 0}
              title={isPlayingA || isPlayingB ? 'Pause both decks before analyzing the library' : 'Analyze unprocessed tracks for tempo, key, energy and waveform'}
            >
              <AudioLines aria-hidden="true" />
              {libraryAnalyzing ? 'ANALYZING…' : 'ANALYZE LIBRARY'}
            </button>
            <label className={`library-import${libraryAnalyzing ? ' is-disabled' : ''}`}>
              <Upload aria-hidden="true" />
              ADD TRACKS
              <input type="file" accept="audio/*" multiple onChange={handleLibraryImport} disabled={libraryAnalyzing} />
            </label>
          </div>
          </div>
          <div className="library-toolbar">
            <label className="library-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                aria-label="Search local tracks"
                placeholder="Search tracks…"
                value={librarySearch}
                onChange={(event) => setLibrarySearch(event.target.value)}
              />
            </label>
          <span role="status">{libraryStatus}</span>
        </div>
        <section className="transition-matches" aria-label="Recommended transition tracks">
          <div className="transition-matches-heading">
            <div>
              <span className="library-kicker"><Sparkles aria-hidden="true" /> SMART TRANSITION PICKS</span>
              <p>
                {recommendationSource
                  ? `REFERENCE · DECK ${recommendationSourceDeck} · ${recommendationSource.name} · ${recommendationSourceBpm.toFixed(1)} BPM`
                  : 'LOAD A TRACK TO GET TRANSITION RECOMMENDATIONS'}
              </p>
            </div>
            <span className="transition-analysis-count">
              {libraryTracks.filter((track) => Number(track.bpm) > 0).length}/{libraryTracks.length} ANALYZED
            </span>
          </div>
          {recommendedTracks.length ? (
            <div className="transition-match-list">
              {recommendedTracks.map(({ track, match }, index) => (
                <article className="transition-match-row" key={track.id}>
                  <span className="transition-match-rank">{String(index + 1).padStart(2, '0')}</span>
                  <div className="transition-match-track">
                    <strong title={track.name}>{track.name}</strong>
                    <span>{track.bpm} BPM · {track.key || 'KEY UNKNOWN'} · {track.energy ? `ENERGY ${track.energy}/10` : 'ENERGY UNKNOWN'}</span>
                    <small>{match.rationale}</small>
                  </div>
                  <span className="transition-match-score" aria-label={`Match score ${match.score} out of 100`}>{match.score}</span>
                  <div className="transition-match-actions">
                    <button
                      type="button"
                      onClick={() => void loadLibraryTrackToDeck(track.id, recommendationTargetDeck)}
                      disabled={libraryAnalyzing}
                    >
                      LOAD {recommendationTargetDeck}
                    </button>
                    <button
                      type="button"
                      onClick={() => addToQueue(track.id)}
                      disabled={queue.includes(track.id) || libraryAnalyzing}
                      aria-label={queue.includes(track.id) ? `${track.name} already queued` : `Add ${track.name} to queue`}
                    >
                      {queue.includes(track.id) ? 'QUEUED' : 'QUEUE'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="transition-match-empty">
              {!recommendationSource
                ? 'Load a track to choose a reference deck.'
                : libraryTracks.length === 0
                  ? 'Add audio files, then analyze the library to build transition matches.'
                  : libraryTracks.some((track) => Number(track.bpm) > 0 && track.id !== deckA.libraryTrackId && track.id !== deckB.libraryTrackId)
                    ? 'No compatible candidates are ready. Check the analyzed BPM and retry after analysis failures.'
                    : libraryTracks.some((track) => !(Number(track.bpm) > 0))
                      ? 'Analyze the collection to find the next best track.'
                      : 'No unused library tracks are available. Add or import more tracks.'}
            </p>
          )}
        </section>
        <div className="library-columns">
          <div className="library-browser">
            <div className="library-column-heading">
              <span>COLLECTION <b>{filteredLibraryTracks.length}</b></span>
              <span>TRACK / ANALYSIS</span>
              <span>ACTIONS</span>
            </div>
            {filteredLibraryTracks.length ? filteredLibraryTracks.map((track) => (
              <div className="library-track-row" key={track.id}>
                <span className="library-track-index">{String(libraryTracks.indexOf(track) + 1).padStart(2, '0')}</span>
                <div className="library-track-info">
                  <strong title={track.name}>{track.name}</strong>
                  <span>{track.bpm ? `${track.bpm} BPM  ·  ${track.key || 'KEY UNKNOWN'}  ·  ${track.energy ? `ENERGY ${track.energy}/10` : 'ENERGY UNKNOWN'}` : track.analysisError ? `ANALYSIS FAILED · ${track.analysisError}` : 'NOT ANALYZED'}</span>
                </div>
                <div className="library-track-actions">
                  <button type="button" aria-label={`Load ${track.name} to Deck A`} onClick={() => void loadLibraryTrackToDeck(track.id, 'A')}>A</button>
                  <button type="button" aria-label={`Load ${track.name} to Deck B`} onClick={() => void loadLibraryTrackToDeck(track.id, 'B')}>B</button>
                  <button
                    type="button"
                    aria-label={queue.includes(track.id) ? `Remove ${track.name} from queue` : `Add ${track.name} to queue`}
                    title={queue.includes(track.id) ? 'Already in queue' : 'Add to queue'}
                    onClick={() => addToQueue(track.id)}
                    disabled={queue.includes(track.id)}
                  >
                    {queue.includes(track.id) ? '✓' : '+'}
                  </button>
                  <button type="button" aria-label={`Remove ${track.name} from library`} onClick={() => void removeLibraryTrack(track.id)} disabled={libraryAnalyzing}>
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </div>
            )) : (
              <p className="library-empty">
                {libraryTracks.length ? 'NO TRACKS MATCH THIS SEARCH' : 'ADD AUDIO FILES TO BUILD YOUR LOCAL COLLECTION'}
              </p>
            )}
          </div>
          <aside className="queue-panel" aria-label="Play queue">
            <div className="queue-heading">
              <span>UP NEXT <b>{queuedTracks.length}</b></span>
              <button type="button" onClick={() => setQueue([])} disabled={!queue.length}>CLEAR</button>
            </div>
            {queuedTracks.length ? queuedTracks.map((track, index) => (
              <div className="queue-track-row" key={track.id}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong title={track.name}>{track.name}</strong>
                <button type="button" aria-label={`Load ${track.name} to active deck`} onClick={() => void loadLibraryTrackToDeck(track.id, activeDeck, true)}>
                  LOAD {activeDeck}
                </button>
                <button type="button" aria-label={`Remove ${track.name} from queue`} onClick={() => removeFromQueue(track.id)}>×</button>
              </div>
            )) : (
              <p className="library-empty">ADD TRACKS FROM THE COLLECTION TO BUILD A PLAY QUEUE</p>
            )}
          </aside>
        </div>
      </section>

      <section className="insight-grid mb-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-500/20 bg-gradient-to-r from-[#15121a] to-[#10121b] p-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 text-amber-300">
            <Sparkles className="h-4 w-4" />
            <h2 className="text-[10px] font-black tracking-[0.17em]">TRANSITION FX ASSIST</h2>
          </div>
          <p className="text-xs font-semibold text-slate-200">
            SUGGEST {FX_OPTIONS.find(({ id }) => id === suggestedFx.type)?.label} · {TIME_DIVISIONS.find(({ beats }) => beats === suggestedFx.division)?.label.toUpperCase()} · DECK {suggestedFx.deck}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{suggestedFx.reason}</p>
          <p className="mt-1 text-[9px] text-slate-600">
            Uses estimated BPM, current beat phase, and crossfader position; musical phrase points are approximate.
          </p>
        </div>
        <button
          type="button"
          onClick={applySuggestedFx}
          disabled={!deckA.audioUrl && !deckB.audioUrl}
          className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-[9px] font-black tracking-wider text-amber-200 transition hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          APPLY TO DECK {suggestedFx.deck}
        </button>
      </section>

      {/* DYNAMIC TRANSITION RECOMMENDATION BOX */}
      <div className={`recommend-panel border rounded-2xl p-5 transition-all ${
        rec.status === 'perfect' ? 'bg-emerald-950/20 border-emerald-500/50 text-emerald-300' :
        rec.status === 'good' ? 'bg-cyan-950/20 border-cyan-500/50 text-cyan-300' :
        rec.status === 'warning' ? 'bg-amber-950/20 border-amber-500/50 text-amber-300' :
        'bg-[#0b0c13] border-slate-800 text-slate-400'
      }`}>
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4" />
          <h2 className="text-xs font-black tracking-wider uppercase">HARMONIC TRANSITION CHECK</h2>
        </div>
        <p className="text-xs font-sans leading-relaxed">{rec.message}</p>
      </div>
    </div>
  );
}