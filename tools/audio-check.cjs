#!/usr/bin/env node
// Usage: node tools/audio-check.cjs [path/to/audio.js]
// Checks graph routing and scheduling with a lightweight mock; does not assess sound quality.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const sourcePath = process.argv[2] || path.resolve(__dirname, '../js/audio.js');
const source = fs.readFileSync(sourcePath, 'utf8');

class AudioParamMock {
  constructor(value = 0) { this.value = value; }
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
  cancelAndHoldAtTime() {}
}

class AudioNodeMock {
  constructor() {
    for (const key of ['gain', 'threshold', 'knee', 'ratio', 'attack', 'release',
      'frequency', 'Q', 'detune', 'pan', 'playbackRate']) {
      this[key] = new AudioParamMock();
    }
    this.connections = [];
  }
  connect(node) { this.connections.push(node); }
  start() {}
  stop() {}
}

class AudioContextMock {
  constructor() {
    this.currentTime = 0;
    // Low sample rate keeps impulse/noise allocations small in this structural check.
    this.sampleRate = 100;
    this.destination = new AudioNodeMock();
    this.state = 'running';
  }
  createOscillator() { return new AudioNodeMock(); }
  createBufferSource() { return new AudioNodeMock(); }
  createGain() { return new AudioNodeMock(); }
  createDynamicsCompressor() { return new AudioNodeMock(); }
  createConvolver() { return new AudioNodeMock(); }
  createBiquadFilter() { return new AudioNodeMock(); }
  createBuffer(channels, length) {
    return { getChannelData: () => new Float32Array(length) };
  }
}

function loadAudio(savedMute = false) {
  const window = { AudioContext: AudioContextMock, addEventListener() {} };
  vm.runInNewContext(source, {
    window,
    localStorage: {
      getItem: () => savedMute ? '1' : '0',
      setItem() {},
    },
    document: { addEventListener() {} },
    setInterval: () => 1,
    clearInterval() {},
    Math, Float32Array, Uint8Array, atob,
  }, { filename: sourcePath });
  window.SFX.ensure();
  return window.SFX;
}

// All dry/wet signal paths must pass through the muted master.
function reaches(node, target, visited = new Set()) {
  if (node === target) return true;
  if (visited.has(node)) return false;
  visited.add(node);
  return node.connections.some(next => reaches(next, target, visited));
}
const audio = loadAudio();
for (const bus of [audio.sfxGain, audio.sfxSend, audio.musicGain, audio.musicSend]) {
  assert.ok(reaches(bus, audio.master), 'audio buses must reach the shared master');
  assert.ok(!reaches(bus, audio.ctx.destination, new Set([audio.master])),
    'audio buses must not bypass the master');
}
audio.setMuted(true);
assert.equal(audio.master.gain.value, 0, 'mute must silence reverb and active effects');
// Avoid starting the periodic sequencer: this assertion isolates the mute control.
audio.musicDesired = false;
audio.setMuted(false);
assert.equal(audio.master.gain.value, 0.9, 'unmute must restore master volume');
assert.equal(loadAudio(true).master.gain.value, 0,
  'saved mute must apply when the audio graph is first initialized');

// Capture musical decisions independently of oscillator implementation.
const pitches = [];
let pattern = [];
audio.scene = 'game';
for (const instrument of ['pad', 'noiseHit', 'marimba', 'flute', 'drum', 'shaker', 'wood']) {
  audio[instrument] = (...args) => pattern.push([instrument, ...args]);
}
audio.bass = frequency => pitches.push(frequency);
audio.scheduleStep(0, 0);
assert.ok(pitches[0] >= 80, 'bass fundamental should be above the deep sub range');
const firstPhrase = JSON.stringify(pattern);
pattern = [];
audio.scheduleStep(64, 0);
assert.notEqual(JSON.stringify(pattern), firstPhrase, 'later musical phrases should vary');

// Exercise every step using the real instrument methods with mocked Web Audio nodes.
const fullAudio = loadAudio();
for (const scene of ['menu', 'game']) {
  fullAudio.scene = scene;
  for (const energy of [0, 1]) {
    fullAudio.energy = energy;
    for (let step = 0; step < 256; step++) {
      fullAudio.scheduleStep(step, step * 60 / 84 / 4);
    }
  }
}
console.log('Audio checks passed: routing, mute, saved mute, bass, phrase variation, 256-step scheduling.');
