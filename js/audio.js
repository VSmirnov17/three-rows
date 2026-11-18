/* Синтезированный звук и фоновая музыка — без внешних файлов */
(() => {
  'use strict';

  const MUSIC_BPM = 84;
  const STEP = 60 / MUSIC_BPM / 4;
  const LOOP_STEPS = 256; // 16 тактов с четырьмя вариациями
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);

  /* Аккорды и пентатоника для мистической темы джунглей (ля минор) */
  const CHORDS = [
    { root: 45, notes: [57, 60, 64], scale: [57, 60, 62, 64, 67, 69] }, // Am
    { root: 41, notes: [53, 57, 60], scale: [53, 57, 60, 62, 65, 69] }, // F
    { root: 48, notes: [55, 60, 64], scale: [55, 60, 62, 64, 67, 72] }, // C
    { root: 43, notes: [55, 59, 62], scale: [55, 59, 62, 64, 67, 71] }  // G
  ];

  const ARP = [0, 2, 1, 3, 2, 4, 1, 3];
  const MELODIES = [
    [
      { at: 0, n: 69, d: 2 }, { at: 3, n: 67, d: 2 }, { at: 6, n: 64, d: 3 },
      { at: 10, n: 62, d: 2 }, { at: 13, n: 60, d: 3 }
    ],
    [
      { at: 0, n: 64, d: 2 }, { at: 3, n: 67, d: 2 }, { at: 6, n: 69, d: 2 },
      { at: 9, n: 72, d: 4 }, { at: 14, n: 67, d: 2 }
    ]
  ];

  const SFX = {
    ctx: null,
    master: null,
    sfxGain: null,
    sfxSend: null,
    musicGain: null,
    musicFilter: null,
    musicSend: null,
    muted: false,
    samples: null,
    samplesLoading: false,
    samplesReady: false,

    /* Состояние фоновой музыки */
    musicDesired: true,
    musicPlaying: false,
    musicPaused: false,
    musicTimer: null,
    nextStepTime: 0,
    step: 0,
    scene: 'menu',
    energy: 0,
    urgencyRequested: 0,
    urgencyLevel: 0,
    urgencyNodes: null,

    init() {
      try {
        this.muted = localStorage.getItem('sun-treasures-muted') === '1';
      } catch (e) { /* ignore */ }

      const unlock = () => {
        this.ensure();
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        if (!this.muted && this.musicDesired && !this.musicPlaying) this.musicStart();
      };
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
      window.addEventListener('touchstart', unlock, { passive: true });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) unlock();
      });
    },

    ensure() {
      if (this.ctx) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      this.ctx = ctx;

      /* Мастер-цепочка с мягкой компрессией, чтобы взрывы не клиппили */
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 24;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      this.master.connect(comp);
      comp.connect(ctx.destination);

      /* Звуковые эффекты */
      this.sfxGain = ctx.createGain();
      this.sfxGain.gain.value = 0.36;
      this.sfxGain.connect(this.master);

      this.sfxSend = ctx.createGain();
      this.sfxSend.gain.value = 1;
      const sfxReverb = ctx.createConvolver();
      sfxReverb.buffer = this.makeImpulse(2.2, 2.6);
      const sfxWet = ctx.createGain();
      sfxWet.gain.value = 0.25;
      this.sfxSend.connect(sfxReverb);
      sfxReverb.connect(sfxWet);
      sfxWet.connect(this.master);

      /* Музыка: фильтр → громкость → мастер + посыл в реверб */
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(this.master);

      this.musicFilter = ctx.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = 1800;
      this.musicFilter.Q.value = 0.4;
      this.musicFilter.connect(this.musicGain);

      this.musicSend = ctx.createGain();
      this.musicSend.gain.value = 1;
      const musicReverb = ctx.createConvolver();
      musicReverb.buffer = this.makeImpulse(2.8, 2.2);
      const musicWet = ctx.createGain();
      musicWet.gain.value = 0.5;
      this.musicSend.connect(musicReverb);
      musicReverb.connect(musicWet);
      musicWet.connect(this.musicGain);

      this.makeNoiseBuffer();
      this.makeShaperCurve();
      this.loadSamples();
    },

    makeImpulse(seconds, decay) {
      const rate = this.ctx.sampleRate;
      const len = Math.floor(rate * seconds);
      const buffer = this.ctx.createBuffer(2, len, rate);
      for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / len;
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        }
      }
      return buffer;
    },

    makeNoiseBuffer() {
      const len = Math.floor(this.ctx.sampleRate * 4);
      const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this._noise = buffer;
    },

    makeShaperCurve() {
      const n = 1024;
      const curve = new Float32Array(n);
      const k = 5;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = Math.tanh(k * x) / Math.tanh(k);
      }
      this._curve = curve;
    },

    /* ---------- Сэмплы SFX ---------- */

    loadSamples() {
      if (this.samplesLoading || this.samples || !this.ctx) return;
      /* Старые синтезированные сэмплы + новые от Stable Audio 3 (js/sfx-sa3.js) */
      const data = Object.assign({}, window.SFX_SAMPLES, window.SFX_SA3_SAMPLES);
      if (!Object.keys(data).length) return;
      this.samplesLoading = true;
      const names = Object.keys(data);
      Promise.all(names.map(name => {
        let buf;
        try {
          buf = this.base64ToArrayBuffer(data[name]);
        } catch (e) {
          return Promise.resolve(null);
        }
        return this.ctx.decodeAudioData(buf)
          .then(decoded => ({ name, buffer: decoded }))
          .catch(() => null);
      })).then(entries => {
        const map = {};
        entries.forEach(entry => {
          if (entry) map[entry.name] = entry.buffer;
        });
        this.samples = map;
        this.samplesReady = true;
        this.samplesLoading = false;
      });
    },

    base64ToArrayBuffer(b64) {
      const binary = atob(b64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    },

    playSample(name, opts = {}) {
      if (this.muted || !this.ctx || !this.samples) return false;
      const buffer = this.samples[name];
      if (!buffer) return false;
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = clamp(opts.rate == null ? 1 : opts.rate, 0.5, 2);
      const gain = ctx.createGain();
      gain.gain.value = opts.gain == null ? 1 : opts.gain;
      src.connect(gain);
      this.connectSfx(gain, opts.wet == null ? 0 : opts.wet, opts.pan == null ? 0 : opts.pan);
      src.start(ctx.currentTime + (opts.delay || 0));
      return true;
    },

    setMuted(muted) {
      this.muted = muted;
      try { localStorage.setItem('sun-treasures-muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
      if (!muted) {
        this.ensure();
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        if (this.musicDesired) this.musicStart();
      }
      // Мастер глушит обе реверберации, включая уже запущенные хвосты.
      if (this.master) {
        const t = this.ctx.currentTime;
        const g = this.master.gain;
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
        else {
          g.cancelScheduledValues(t);
          g.setValueAtTime(g.value, t);
        }
        g.linearRampToValueAtTime(muted ? 0 : 0.9, t + 0.04);
      }
      this.urgencyLevel = muted ? 0 : this.urgencyRequested;
      if (!this.muted && this.urgencyLevel > 0 && !this.urgencyNodes) this.startUrgency();
      if (this.urgencyNodes) this.applyUrgency();
      this.applyMusicGain(0.4);
    },

    /* ---------- Фоновая музыка ---------- */

    musicScene(scene) {
      this.scene = scene;
      if (!this.ctx || !this.musicFilter) return;
      const t = this.ctx.currentTime;
      const target = scene === 'game' ? 14000 : 2000;
      const f = this.musicFilter.frequency;
      f.cancelScheduledValues(t);
      f.setValueAtTime(f.value, t);
      f.linearRampToValueAtTime(target, t + 0.9);
      this.applyMusicGain(0.9);
    },

    applyMusicGain(fade = 0.5) {
      if (!this.ctx || !this.musicGain) return;
      const duck = 1 - clamp(this.urgencyLevel || 0, 0, 1) * 0.3;
      const target = (!this.muted && this.musicDesired && !this.musicPaused)
        ? (this.scene === 'game' ? 0.55 : 0.3) * duck
        : 0;
      const t = this.ctx.currentTime;
      const g = this.musicGain.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
      else {
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
      }
      g.linearRampToValueAtTime(target, t + fade);
    },

    musicStart(scene) {
      this.musicDesired = true;
      if (scene) this.musicScene(scene);
      this.ensure();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.musicPaused = false;
      if (!this.musicPlaying) {
        this.musicPlaying = true;
        this.step = 0;
        this.nextStepTime = this.ctx.currentTime + 0.12;
        this.musicTimer = setInterval(() => this.scheduler(), 25);
      }
      this.scheduler();
      this.applyMusicGain(1.4);
    },

    musicStop(fade = 0.8) {
      this.musicDesired = false;
      this.musicPlaying = false;
      this.musicPaused = false;
      if (this.musicTimer) {
        clearInterval(this.musicTimer);
        this.musicTimer = null;
      }
      this.applyMusicGain(fade);
    },

    musicPause() {
      this.musicPaused = true;
      this.applyMusicGain(0.45);
    },

    musicResume() {
      this.musicDesired = true;
      if (!this.musicPlaying) {
        this.musicStart();
        return;
      }
      this.musicPaused = false;
      this.applyMusicGain(0.7);
    },

    setEnergy(mult) {
      this.energy = clamp((mult - 1) / 7, 0, 1);
    },

    /* ---------- Нагнетание на последних секундах ---------- */

    setUrgency(level) {
      const req = clamp(level, 0, 1);
      this.urgencyRequested = req;
      const effective = this.muted ? 0 : req;
      if (Math.abs(effective - this.urgencyLevel) < 0.01) return;
      this.urgencyLevel = effective;
      if (!this.ctx) return;
      if (effective > 0 && !this.urgencyNodes) this.startUrgency();
      this.applyUrgency();
      this.applyMusicGain(0.6);
    },

    startUrgency() {
      if (!this.ctx || this.urgencyNodes) return;
      const ctx = this.ctx;
      const out = ctx.createGain();
      out.gain.value = 0;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 160;
      filter.Q.value = 1.1;

      const o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.value = 55;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = 55.9;
      const o3 = ctx.createOscillator();
      o3.type = 'triangle';
      o3.frequency.value = 82.4;
      const g3 = ctx.createGain();
      g3.gain.value = 0.35;

      /* Медленное биение и пульсация — «механизм» под часами */
      const pulse = ctx.createGain();
      pulse.gain.value = 0.75;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.9;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.25;
      lfo.connect(lfoGain);
      lfoGain.connect(pulse.gain);

      o1.connect(filter);
      o2.connect(filter);
      o3.connect(g3);
      g3.connect(filter);
      filter.connect(pulse);
      pulse.connect(out);
      out.connect(this.sfxGain);

      [o1, o2, o3, lfo].forEach(o => o.start());
      this.urgencyNodes = { out, filter, o1, o2, o3, pulse, lfo };
    },

    applyUrgency() {
      if (!this.ctx || !this.urgencyNodes) return;
      const t = this.ctx.currentTime;
      const level = clamp(this.urgencyLevel, 0, 1);
      const n = this.urgencyNodes;

      const g = n.out.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(level > 0.001 ? 0.028 + level * 0.105 : 0, t + 0.35);

      const f = n.filter.frequency;
      f.cancelScheduledValues(t);
      f.setValueAtTime(f.value, t);
      f.linearRampToValueAtTime(150 + level * 190, t + 0.5);

      const base = 1 + level * 0.08;
      n.o1.frequency.setTargetAtTime(55 * base, t, 0.4);
      n.o2.frequency.setTargetAtTime(55.9 * base, t, 0.4);
      n.o3.frequency.setTargetAtTime(82.4 * base, t, 0.4);
      n.lfo.frequency.setTargetAtTime(0.9 + level * 0.9, t, 0.5);
    },

    /* Механические часы: тик-так, ускоряющийся и усиливающийся к нулю */
    clockTick(left) {
      if (this.muted) return;
      this.ensure();
      if (!this.ctx) return;
      const ctx = this.ctx;
      const tension = clamp((45 - left) / 45, 0, 1);
      const sec = Math.max(1, Math.ceil(left));
      const even = sec % 2 === 0;
      const pan = even ? -0.2 : 0.2;
      const gain = 0.34 + tension * 0.46;
      const name = even ? 'clockTick' : 'clockTock';
      const t = ctx.currentTime + 0.005;

      const played = this.playSample(name, {
        rate: (even ? 1 : 0.97) * (0.995 + Math.random() * 0.01),
        gain,
        wet: 0.05,
        pan
      });
      if (!played) {
        this.noiseHit({
          time: t, dur: 0.03, gain: 0.11 + tension * 0.05,
          type: 'highpass', f0: 2600, f1: 2600, q: 0.7, send: 0.05, pan
        });
        this.tone(even ? 2200 : 1250, 0.05, {
          type: 'triangle', gain: 0.07 + tension * 0.04, wet: 0.05, pan
        });
        this.tone(even ? 300 : 190, 0.06, {
          type: 'sine', gain: 0.05, wet: 0.05, pan
        });
      }

      /* Пульс сердца на последних 20 секундах */
      if (left <= 20) {
        this.boom(t, 0.05 + tension * 0.05, 76, 42, 0.2, 0);
      }

      /* Последние 10 секунд — второй удар между тиками */
      if (left <= 10 && left > 0.6) {
        const off = this.playSample(even ? 'clockTock' : 'clockTick', {
          rate: 0.96,
          gain: gain * 0.55,
          wet: 0.05,
          pan: -pan,
          delay: 0.5
        });
        if (!off) {
          this.tone(even ? 1250 : 2200, 0.04, {
            type: 'triangle', gain: 0.05, wet: 0.05, pan: -pan, delay: 0.5
          });
        }
        this.boom(t + 0.5, 0.03 + tension * 0.03, 68, 40, 0.16, 0);
      }
    },

    scheduler() {
      if (!this.ctx || !this.musicPlaying) return;
      if (this.nextStepTime < this.ctx.currentTime - 0.1) {
        this.nextStepTime = this.ctx.currentTime + 0.05;
      }
      const horizon = this.ctx.currentTime + 0.16;
      let guard = 0;
      while (this.nextStepTime < horizon && guard++ < 64) {
        if (!this.musicPaused && !this.muted) {
          this.scheduleStep(this.step, this.nextStepTime);
        }
        this.nextStepTime += STEP;
        this.step = (this.step + 1) % LOOP_STEPS;
      }
    },

    scheduleStep(step, time) {
      const absoluteBar = Math.floor(step / 16);
      const phrase = Math.floor(absoluteBar / 4);
      const bar = absoluteBar % 4;
      const pos = step % 16;
      const chord = CHORDS[bar];
      const energy = this.energy;
      const inGame = this.scene === 'game';
      const intensity = inGame ? 1 : 0.55;
      const arpOffset = [0, 2, 5, 1][phrase % 4];

      if (pos === 0) {
        chord.notes.forEach((n, i) => {
          this.pad(midi(n - 12), time, STEP * 16, 0.026, i);
        });
        this.bass(midi(chord.root), time, 0.55, 0.12 * intensity);
        this.noiseHit({
          time, dur: STEP * 16, gain: 0.018, type: 'bandpass',
          f0: 320, f1: 1100, q: 0.5, send: 0.9, bus: 'music'
        });
      }
      if (pos === 8) this.bass(midi(chord.root), time, 0.45, 0.085 * intensity);
      if (inGame && (pos === 6 || pos === 14)) this.bass(midi(chord.root + 7), time, 0.3, 0.045);

      if (pos % 2 === 0 && (inGame || pos % 4 === 0) && !(phrase === 2 && pos === 14)) {
        const idx = ARP[((pos / 2) + bar * 2 + arpOffset) % ARP.length] % chord.scale.length;
        const note = chord.scale[idx];
        this.marimba(midi(note), time, (0.06 + energy * 0.03) * intensity, pos === 0 ? 0.7 : 0.45);
        if (energy > 0.45 && pos % 4 === 2) {
          this.marimba(midi(note + 12), time + STEP * 0.5, 0.03, 0.5);
        }
      }

      if (pos === 0 && (bar === 1 || bar === 3) && (inGame || phrase % 2 === 1)) {
        const melody = MELODIES[(bar === 1 ? 0 : 1) ^ (phrase % 2)];
        melody.forEach(n => {
          this.flute(midi(n.n), time + n.at * STEP, n.d * STEP, 0.05, 0.7);
        });
      }

      // Меню — редкие удары; игровая перкуссия раскрывается после старта.
      if (!inGame) {
        if (pos === 0 && bar % 2 === 0) this.drum(time, 0.08, 0.9);
        return;
      }
      if (pos === 0) this.drum(time, 0.22 + energy * 0.08, 1);
      if (pos === 4) this.drum(time, 0.1, 0.82);
      if (pos === 8) this.drum(time, 0.18 + energy * 0.06, 0.95);
      if (pos === (phrase % 2 ? 10 : 11)) this.drum(time, 0.07, 1.18);
      if (pos === 14) this.drum(time, 0.09, 0.9);

      if (pos % 2 === 0) this.shaker(time, pos % 4 === 0 ? 0.05 : 0.028);
      if (energy > 0.35 && pos % 2 === 1) this.shaker(time, 0.018);
      if (pos === 6 || pos === 14) this.wood(time, 0.035);
      if (phrase === 3 && bar === 3 && pos === 15) this.wood(time, 0.055);
    },

    connectMusic(node, wet) {
      node.connect(this.musicFilter);
      if (wet > 0) {
        const send = this.ctx.createGain();
        send.gain.value = wet;
        node.connect(send);
        send.connect(this.musicSend);
      }
    },

    pad(freq, time, dur, gain, idx) {
      const ctx = this.ctx;
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = 'triangle';
      o2.type = 'sawtooth';
      o1.frequency.value = freq;
      o2.frequency.value = freq;
      o2.detune.value = 6 + idx * 2;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 720;
      filter.Q.value = 0.6;
      const g = ctx.createGain();
      const peak = gain * (1 + idx * 0.08);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(peak, time + 1.2);
      g.gain.setValueAtTime(peak, time + dur - 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      o1.connect(filter);
      o2.connect(filter);
      filter.connect(g);
      this.connectMusic(g, 0.55);
      o1.start(time);
      o2.start(time);
      o1.stop(time + dur + 0.05);
      o2.stop(time + dur + 0.05);
    },

    bass(freq, time, dur, gain) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = freq / 2;
      const subGain = ctx.createGain();
      subGain.gain.value = 0.18;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gain, time + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      o.connect(filter);
      sub.connect(subGain);
      subGain.connect(filter);
      filter.connect(g);
      this.connectMusic(g, 0.08);
      o.start(time);
      sub.start(time);
      o.stop(time + dur + 0.05);
      sub.stop(time + dur + 0.05);
    },

    marimba(freq, time, gain, vel) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const h = ctx.createOscillator();
      h.type = 'triangle';
      h.frequency.value = freq * 2;
      const hg = ctx.createGain();
      hg.gain.value = 0.16;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gain * vel, time + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.5);
      o.connect(g);
      h.connect(hg);
      hg.connect(g);
      this.connectMusic(g, 0.45);
      o.start(time);
      h.start(time);
      o.stop(time + 0.55);
      h.stop(time + 0.55);
    },

    flute(freq, time, dur, gain, wet) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const o2 = ctx.createOscillator();
      o2.type = 'triangle';
      o2.frequency.value = freq;
      const o2g = ctx.createGain();
      o2g.gain.value = 0.22;
      const mix = ctx.createGain();
      o.connect(mix);
      o2.connect(o2g);
      o2g.connect(mix);

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.2;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = freq * 0.006;
      lfo.connect(lfoGain);
      lfoGain.connect(o.frequency);
      lfoGain.connect(o2.frequency);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, time);
      env.gain.linearRampToValueAtTime(gain, time + 0.14);
      env.gain.setValueAtTime(gain, time + Math.max(0.2, dur - 0.2));
      env.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      mix.connect(env);
      this.connectMusic(env, wet);

      o.start(time);
      o2.start(time);
      lfo.start(time);
      o.stop(time + dur + 0.05);
      o2.stop(time + dur + 0.05);
      lfo.stop(time + dur + 0.05);
    },

    drum(time, gain, pitch) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150 * pitch, time);
      o.frequency.exponentialRampToValueAtTime(46 * pitch, time + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gain, time + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);
      o.connect(g);
      this.connectMusic(g, 0.18);
      o.start(time);
      o.stop(time + 0.26);
    },

    shaker(time, gain) {
      this.noiseHit({
        time, dur: 0.055, gain, type: 'highpass',
        f0: 6200, f1: 7000, q: 0.6, send: 0.2, bus: 'music'
      });
    },

    wood(time, gain) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 1380;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gain, time + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
      o.connect(g);
      this.connectMusic(g, 0.15);
      o.start(time);
      o.stop(time + 0.08);
    },

    /* ---------- Базовые узлы ---------- */

    makePan(pan) {
      if (!this.ctx.createStereoPanner || !pan) return null;
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      return p;
    },

    connectSfx(node, wet, pan) {
      const panner = this.makePan(pan);
      let out = node;
      if (panner) {
        node.connect(panner);
        out = panner;
      }
      out.connect(this.sfxGain);
      if (wet > 0) {
        const send = this.ctx.createGain();
        send.gain.value = wet;
        out.connect(send);
        send.connect(this.sfxSend);
      }
    },

    tone(freq, dur, opts = {}) {
      if (this.muted) return;
      this.ensure();
      if (!this.ctx) return;
      const now = this.ctx.currentTime + (opts.delay || 0);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(freq, now);
      if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, now + dur);
      const peak = (opts.gain == null ? 0.14 : opts.gain);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(gain);
      this.connectSfx(gain, opts.wet || 0, opts.pan || 0);
      osc.start(now);
      osc.stop(now + dur + 0.03);
    },

    noiseHit(opts) {
      if (this.muted) return;
      this.ensure();
      if (!this.ctx) return;
      const ctx = this.ctx;
      const {
        dur = 0.3, gain = 0.2, type = 'lowpass',
        f0 = 1200, f1 = 200, q = 0.7, send = 0.25,
        pan = 0, bus = 'sfx'
      } = opts;
      const time = Math.max(ctx.currentTime, opts.time == null ? ctx.currentTime : opts.time);
      const src = ctx.createBufferSource();
      src.buffer = this._noise;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.Q.value = q;
      filter.frequency.setValueAtTime(f0, time);
      if (f1 !== f0) filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), time + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gain, time + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      src.connect(filter);
      filter.connect(g);
      if (bus === 'music') this.connectMusic(g, send);
      else this.connectSfx(g, send, pan);
      src.start(time, Math.random() * 0.4);
      src.stop(time + dur + 0.02);
    },

    boom(time, gain, f0, f1, dur, pan) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, time);
      o.frequency.exponentialRampToValueAtTime(f1, time + dur * 0.85);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gain, time + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      const shaper = ctx.createWaveShaper();
      shaper.curve = this._curve;
      shaper.oversample = '2x';
      o.connect(g);
      g.connect(shaper);
      this.connectSfx(shaper, 0.35, pan);
      o.start(time);
      o.stop(time + dur + 0.05);
    },

    zap(time, gain, pan) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(1700, time);
      o.frequency.exponentialRampToValueAtTime(110, time + 0.3);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.2;
      filter.frequency.setValueAtTime(1900, time);
      filter.frequency.exponentialRampToValueAtTime(280, time + 0.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gain, time + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.32);
      o.connect(filter);
      filter.connect(g);
      this.connectSfx(g, 0.3, pan);
      o.start(time);
      o.stop(time + 0.34);
    },

    sparkle(freq, gain, wet, pan) {
      [0, 4, 7, 12].forEach((semi, i) => {
        this.tone(freq * Math.pow(2, semi / 12), 0.45, {
          type: 'sine', gain, delay: i * 0.04, wet, pan
        });
      });
    },

    /* ---------- Игровые эффекты ---------- */

    click() {
      if (this.playSample('uiClick', { rate: 0.97 + Math.random() * 0.06, gain: 0.7 })) return;
      this.tone(660, 0.08, { type: 'triangle', gain: 0.1 });
    },

    swap() {
      this.tone(440, 0.09, { type: 'sine', gain: 0.09, slideTo: 620 });
    },

    invalid() {
      this.tone(150, 0.18, { type: 'sawtooth', gain: 0.07, slideTo: 105 });
    },

    match(chain, count = 3, hasBlast = false) {
      const base = 392 * Math.pow(2, Math.min(chain - 1, 6) / 12);
      const rate = 0.98 + Math.random() * 0.04 + Math.min(0.06, (chain - 1) * 0.008);
      const played = this.playSample(count >= 5 ? 'matchBig' : 'match', {
        rate,
        gain: hasBlast ? 0.55 : (count >= 5 ? 0.9 : 0.8),
        wet: 0.06
      });
      if (played) {
        if (chain >= 2) this.sparkle(base * 2, 0.022, 0.4);
        return;
      }

      const notes = count >= 5 ? [1, 1.26, 1.5, 2] : [1, 1.26, 1.5];
      notes.forEach((k, i) => {
        this.tone(base * k, 0.24, {
          type: 'triangle', gain: 0.085, delay: i * 0.045, wet: 0.3
        });
      });
      if (count >= 5 || chain >= 3) {
        this.tone(base * 3, 0.5, { type: 'sine', gain: 0.05, delay: 0.12, wet: 0.65 });
      }
      if (!hasBlast && (count >= 5 || chain >= 3)) {
        this.noiseHit({
          dur: 0.28, gain: 0.09, type: 'lowpass',
          f0: 1600, f1: 140, q: 0.8, send: 0.45
        });
        this.boom(this.ctx.currentTime + 0.005, 0.1, 130, 45, 0.35, 0);
      }
      if (chain >= 2) {
        this.sparkle(base * 2, 0.032, 0.55);
      }
    },

    special() {
      if (this.playSample('specialSpawn', {
        rate: 0.98 + Math.random() * 0.04,
        gain: 0.9,
        wet: 0.08
      })) return;

      [523, 659, 784, 1046].forEach((f, i) => {
        this.tone(f, 0.35, { type: 'sine', gain: 0.08, delay: i * 0.05, wet: 0.4 });
      });
      this.tone(2093, 0.6, { type: 'sine', gain: 0.035, delay: 0.18, wet: 0.75 });
    },

    /* Взрыв особого камня: чем больше линий/солнц и каскад — тем мощнее */
    blast(opts = {}) {
      if (this.muted) return;
      this.ensure();
      if (!this.ctx) return;
      const { line = 0, sun = 0, bomb = 0, chain = 1, pan = 0 } = opts;
      const power = clamp(0.85 + (line + sun) * 0.28 + (chain - 1) * 0.1, 0.85, 1.9);
      const t = this.ctx.currentTime + 0.01;
      const gainScale = clamp(0.82 + power * 0.1, 0.82, 1.05);
      let played = false;

      if (line > 0) {
        const name = Math.random() < 0.5 ? 'lineBlast' : 'lineBlast2';
        played = this.playSample(name, {
          rate: 0.97 + Math.random() * 0.06,
          gain: gainScale * (sun > 0 ? 0.72 : 1),
          wet: 0.05,
          pan
        }) || played;
        if (line > 1) {
          this.playSample(name === 'lineBlast' ? 'lineBlast2' : 'lineBlast', {
            rate: 0.92 + Math.random() * 0.05,
            gain: 0.42 * gainScale,
            delay: 0.055,
            wet: 0.05,
            pan: -pan * 0.6
          });
        }
      }

      if (sun > 0) {
        const name = Math.random() < 0.5 ? 'sunBlast' : 'sunBlast2';
        played = this.playSample(name, {
          rate: 0.97 + Math.random() * 0.05,
          gain: gainScale,
          wet: 0.05,
          pan
        }) || played;
        if (sun > 1) {
          this.playSample(name === 'sunBlast' ? 'sunBlast2' : 'sunBlast', {
            rate: 0.93 + Math.random() * 0.04,
            gain: 0.38 * gainScale,
            delay: 0.08,
            wet: 0.08,
            pan: -pan * 0.6
          });
        }
      }

      if (bomb > 0) {
        played = this.playSample('blastBomb', {
          rate: 0.97 + Math.random() * 0.06,
          gain: gainScale * (line + sun > 0 ? 0.7 : 1),
          wet: 0.05,
          pan
        }) || played;
      }

      if (played) {
        this.boom(t, 0.10 * power, 130, 32, 0.45, pan);
        if (sun > 0) this.sparkle(1568, 0.018 * power, 0.45, pan);
        return;
      }

      this.boom(t, 0.38 * power, 150, 28, 0.75, pan);
      this.noiseHit({
        time: t, dur: 0.55, gain: 0.3 * power, type: 'lowpass',
        f0: 3200, f1: 90, q: 0.8, send: 0.5, pan
      });
      this.noiseHit({
        time: t, dur: 0.12, gain: 0.16 * power, type: 'highpass',
        f0: 1800, f1: 6000, q: 0.6, send: 0.3, pan
      });
      this.zap(t, 0.06 * power, pan);

      [0, 3, 7, 12].forEach((semi, i) => {
        this.tone(220 * Math.pow(2, semi / 12), 0.7, {
          type: 'triangle', gain: 0.05 * power, delay: 0.02 + i * 0.012, wet: 0.8, pan
        });
      });
      this.sparkle(1046, 0.045 * power, 0.55, pan);

      if (sun > 0) {
        [1046, 1318, 1568, 2093].forEach((f, i) => {
          this.tone(f, 0.9, {
            type: 'sine', gain: 0.06 * power, delay: 0.04 + i * 0.055, wet: 0.9, pan
          });
        });
        this.noiseHit({
          time: t + 0.05, dur: 1.1, gain: 0.08 * power, type: 'bandpass',
          f0: 600, f1: 5000, q: 0.7, send: 1, pan
        });
      }

      if (line > 0) {
        this.tone(160, 0.4, {
          type: 'sawtooth', gain: 0.07 * power, slideTo: 52, wet: 0.5, pan
        });
      }
    },

    impact() {
      if (this.playSample('impact', {
        rate: 0.97 + Math.random() * 0.06,
        gain: 0.75,
        wet: 0.06
      })) return;
      if (this.muted || !this.ctx) return;
      this.noiseHit({
        dur: 0.28, gain: 0.09, type: 'lowpass',
        f0: 1600, f1: 140, q: 0.8, send: 0.45
      });
      this.boom(this.ctx.currentTime + 0.005, 0.1, 130, 45, 0.35, 0);
    },

    hint() {
      if (this.playSample('hintChime', { rate: 0.97 + Math.random() * 0.06, gain: 0.7, wet: 0.06 })) return;
      this.tone(880, 0.15, { type: 'sine', gain: 0.06 });
      this.tone(1174, 0.2, { type: 'sine', gain: 0.05, delay: 0.1 });
    },

    win() {
      if (this.playSample('victory', { rate: 0.97 + Math.random() * 0.06, gain: 0.9, wet: 0.08 })) return;
      [523, 659, 784, 1046, 1318].forEach((f, i) => {
        this.tone(f, 0.6, { type: 'triangle', gain: 0.1, delay: i * 0.12, wet: 0.4 });
      });
      this.sparkle(1568, 0.05, 0.7);
    },

    lose() {
      if (this.playSample('defeat', { rate: 0.97 + Math.random() * 0.06, gain: 0.9, wet: 0.08 })) return;
      [392, 330, 262, 196].forEach((f, i) => {
        this.tone(f, 0.5, { type: 'sine', gain: 0.1, delay: i * 0.15, wet: 0.35 });
      });
      this.noiseHit({ dur: 0.9, gain: 0.06, type: 'lowpass', f0: 800, f1: 90, send: 0.5 });
    }
  };

  SFX.init();
  window.SFX = SFX;
})();
