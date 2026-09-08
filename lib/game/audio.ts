/**
 * VOIDBREAKER — dependency-free, procedural Web Audio score and effects.
 * Call unlock() from a pointer/keyboard gesture. Nothing starts before it.
 * All pitches are synthesized; this module has no asset or network requests.
 */
export type AudioScene = 'menu' | 'combat' | 'boss' | 'quiet';

type Wave = OscillatorType;
type Tone = {
  at: number;
  hz: number;
  toHz?: number;
  duration: number;
  level: number;
  wave?: Wave;
  attack?: number;
  release?: number;
  cutoff?: number;
  detune?: number;
  music?: boolean;
  room?: boolean;
  echo?: boolean;
};

type Noise = {
  at: number;
  duration: number;
  level: number;
  frequency: number;
  toFrequency?: number;
  filter?: BiquadFilterType;
  q?: number;
  attack?: number;
  music?: boolean;
  room?: boolean;
};

const SOUND_IDS: Readonly<Record<string, number>> = {
  shoot: 0, enemyShoot: 1, hit: 2, shield: 3, hurt: 4, explosion: 5,
  dash: 6, pulse: 7, pickup: 8, levelup: 9, upgrade: 10, boss: 11,
  victory: 12, defeat: 13, click: 14,
};
const COOLDOWNS = [0.055, 0.095, 0.035, 0.12, 0.16, 0.075, 0.10,
  0.16, 0.045, 0.60, 0.12, 1.5, 2.0, 2.0, 0.055] as const;

// D minor / Bb major / F major / C suspended. Upper extensions keep it spacious.
const CHORDS = [
  [50, 57, 60, 64], [46, 53, 57, 60],
  [48, 53, 57, 64], [48, 55, 62, 65],
] as const;
const ROOTS = [38, 34, 41, 36] as const;
const BOSS_CHORDS = [
  [50, 53, 57, 62], [46, 53, 58, 65],
  [43, 50, 58, 62], [45, 52, 57, 61],
] as const;
const BOSS_ROOTS = [38, 34, 31, 33] as const;
const ARP_ORDER = [0, 2, 1, 3, 2, 1, 3, 2] as const;
const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
const midi = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private mix: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private roomSend: GainNode | null = null;
  private echoSend: GainNode | null = null;
  private delay: DelayNode | null = null;
  private noise: AudioBuffer | null = null;
  private graphNodes: AudioNode[] = [];
  private voices = new Set<AudioScheduledSourceNode>();
  private musicVoices = new Set<AudioScheduledSourceNode>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private unlockTask: Promise<void> | null = null;
  private disposed = false;
  private unlocked = false;
  private muted = false;
  private volume = 0.65;
  private scene: AudioScene = 'menu';
  private intensity = 0;
  private intensityTarget = 0;
  private nextStepTime = 0;
  private step = 0;
  private bar = 0;
  private lastTone = new Float64Array(COOLDOWNS.length).fill(-Infinity);

  constructor() {
    // Intentionally inert: safe to construct before the first gesture or in SSR.
  }

  /** Call directly inside a user input handler. Repeated calls are safe. */
  async unlock(): Promise<void> {
    if (this.disposed || typeof window === 'undefined') return;
    if (this.unlockTask) return this.unlockTask;
    this.unlockTask = this.startAudio();
    try {
      await this.unlockTask;
    } finally {
      this.unlockTask = null;
    }
  }

  private async startAudio(): Promise<void> {
    try {
      if (!this.ctx) {
        const audioWindow = window as Window & {
          webkitAudioContext?: typeof AudioContext;
        };
        const AudioContextClass = window.AudioContext || audioWindow.webkitAudioContext;
        if (!AudioContextClass) return;
        this.ctx = new AudioContextClass({ latencyHint: 'interactive' });
        this.buildGraph(this.ctx);
      }
      const ctx = this.ctx;
      if (ctx.state === 'closed') return;
      // resume() is reached synchronously from unlock's gesture before its await.
      if (ctx.state !== 'running') await ctx.resume();
      if (this.disposed || ctx.state !== 'running') return;
      const firstUnlock = !this.unlocked;
      this.unlocked = true;
      if (firstUnlock) this.resetTransport(ctx.currentTime + 0.08);
      this.setMasterLevel();
      if (!this.timer) this.timer = setInterval(this.schedule, 25);
      this.schedule();
    } catch {
      // A denied/interrupted browser unlock is retried on the next user gesture.
      this.unlocked = false;
    }
  }

  setMuted(muted: boolean): void {
    if (this.disposed || this.muted === muted) return;
    this.muted = muted;
    this.setMasterLevel();
    const ctx = this.ctx;
    if (!ctx) return;
    if (muted) {
      // Stop scheduled notes as well as currently audible sources.
      this.stopVoices(this.voices, ctx.currentTime + 0.08);
    } else {
      this.resetTransport(ctx.currentTime + 0.10);
    }
  }

  setVolume(n: number): void {
    this.volume = clamp(n, 0, 1);
    this.setMasterLevel();
  }

  setIntensity(n: number): void {
    this.intensityTarget = clamp(n, 0, 1);
  }

  /** quiet silences and stops the musical transport; UI effects remain available. */
  setScene(scene: AudioScene): void {
    if (this.disposed || this.scene === scene) return;
    this.scene = scene;
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const now = ctx.currentTime;
    const gain = this.musicGain.gain;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(0, now, 0.018);
    gain.setValueAtTime(0, now + 0.10);
    this.stopVoices(this.musicVoices, now + 0.10);
    this.resetTransport(now + 0.14);
    if (scene !== 'quiet') gain.setTargetAtTime(0.78, now + 0.12, 0.18);
    if (this.delay) this.delay.delayTime.setTargetAtTime(60 / this.bpm() * 0.75, now, 0.08);
  }

  /** No allocations or audio scheduling in the animation loop. dt is in seconds. */
  update(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    this.intensity += (this.intensityTarget - this.intensity) *
      (1 - Math.exp(-Math.min(dt, 0.25) * 2.5));
  }

  /** pitch is a frequency multiplier, normally 1 (safe range: 0.35–3). */
  play(name: string, pitch = 1): void {
    const ctx = this.ctx;
    if (this.disposed || !this.unlocked || this.muted || this.volume <= 0 ||
      !ctx || ctx.state !== 'running') return;
    const id = SOUND_IDS[name];
    if (typeof id !== 'number') return;
    const now = ctx.currentTime + 0.003;
    if (now - this.lastTone[id] < COOLDOWNS[id]) return;
    this.lastTone[id] = now;
    const p = clamp(pitch, 0.35, 3);
    const tone = (hz: number, toHz: number, duration: number, level: number,
      wave: Wave = 'sine', delay = 0, cutoff?: number): void => {
      this.tone({ at: now + delay, hz: hz * p, toHz: toHz * p, duration,
        level, wave, cutoff, attack: 0.002 });
    };
    switch (name) {
      case 'shoot':
        tone(1040, 235, 0.10, 0.10, 'triangle', 0, 3900);
        tone(170, 100, 0.045, 0.055);
        break;
      case 'enemyShoot':
        tone(380, 155, 0.16, 0.068, 'sawtooth', 0, 1200);
        tone(625, 310, 0.085, 0.025, 'sine');
        break;
      case 'hit':
        this.burst({ at: now, duration: 0.06, level: 0.105,
          frequency: 2300 * p, filter: 'bandpass', q: 0.75 });
        tone(440, 125, 0.065, 0.082, 'triangle');
        break;
      case 'shield':
        tone(1240, 450, 0.31, 0.074, 'sine');
        tone(1770, 900, 0.25, 0.044, 'sine', 0.017);
        this.burst({ at: now, duration: 0.16, level: 0.04,
          frequency: 5400, filter: 'highpass' });
        break;
      case 'hurt':
        tone(140, 47, 0.30, 0.21, 'triangle');
        tone(320, 80, 0.15, 0.064, 'sawtooth', 0, 900);
        this.burst({ at: now, duration: 0.22, level: 0.13,
          frequency: 1800, toFrequency: 360, filter: 'lowpass' });
        break;
      case 'explosion':
        tone(102, 27, 0.64, 0.32, 'sine');
        tone(160, 40, 0.28, 0.09, 'triangle');
        this.burst({ at: now, duration: 0.66, level: 0.25,
          frequency: 5200, toFrequency: 140, filter: 'lowpass' });
        this.burst({ at: now, duration: 0.12, level: 0.11,
          frequency: 2100, filter: 'bandpass', q: 0.5 });
        break;
      case 'dash':
        this.burst({ at: now, duration: 0.31, level: 0.16, attack: 0.025,
          frequency: 320, toFrequency: 7200, filter: 'bandpass', q: 0.8 });
        tone(115, 580, 0.17, 0.075, 'sine');
        tone(850, 260, 0.18, 0.039, 'triangle', 0.08);
        break;
      case 'pulse':
        tone(72, 31, 0.65, 0.30, 'sine');
        tone(360, 62, 0.40, 0.095, 'triangle');
        this.burst({ at: now, duration: 0.6, level: 0.18,
          frequency: 7000, toFrequency: 220, filter: 'lowpass', attack: 0.01 });
        tone(900, 2400, 0.23, 0.038, 'sine', 0.025);
        break;
      case 'pickup':
        tone(880, 1109, 0.105, 0.065, 'sine');
        tone(1320, 1760, 0.16, 0.048, 'sine', 0.045);
        break;
      case 'levelup':
        this.chime([62, 65, 69, 74, 77, 81], now, 0.075, 0.065, p);
        tone(146.83, 146.83, 0.8, 0.09, 'triangle', 0, 1100);
        break;
      case 'upgrade':
        this.chime([62, 69, 74, 77], now, 0.055, 0.06, p);
        break;
      case 'boss':
        tone(73.42, 55, 1.75, 0.23, 'sawtooth', 0, 500);
        tone(110, 82.4, 1.50, 0.075, 'sawtooth', 0.025, 800);
        tone(880, 146.83, 1.1, 0.065, 'sine');
        this.burst({ at: now, duration: 1.8, level: 0.12,
          frequency: 120, toFrequency: 2600, filter: 'bandpass', attack: 0.35 });
        break;
      case 'victory':
        this.chime([62, 69, 74, 77, 81, 86], now, 0.11, 0.083, p);
        [50, 57, 62, 65, 69].forEach((note, i) => this.tone({
          at: now + 0.42 + i * 0.016, hz: midi(note) * p, duration: 2.4,
          level: 0.034, wave: 'triangle', attack: 0.13, release: 1.7, cutoff: 1700,
        }));
        break;
      case 'defeat':
        this.chime([62, 57, 53, 50], now, 0.18, 0.065, p);
        tone(73.42, 36.71, 1.8, 0.19, 'sine');
        this.burst({ at: now, duration: 1.3, level: 0.10,
          frequency: 1800, toFrequency: 90, filter: 'lowpass' });
        break;
      case 'click':
        tone(740, 980, 0.06, 0.045, 'sine');
        break;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unlocked = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const ctx = this.ctx;
    if (ctx) {
      this.stopVoices(this.voices, ctx.currentTime);
      for (const node of this.graphNodes) {
        try { node.disconnect(); } catch { /* Already disconnected. */ }
      }
      if (ctx.state !== 'closed') void ctx.close().catch(() => {});
    }
    this.voices.clear();
    this.musicVoices.clear();
    this.graphNodes.length = 0;
    this.noise = null;
    this.ctx = null;
    this.master = this.mix = this.musicGain = this.sfxGain = null;
    this.roomSend = this.echoSend = null;
    this.compressor = null;
    this.musicFilter = null;
    this.delay = null;
  }

  private buildGraph(ctx: AudioContext): void {
    this.mix = ctx.createGain();
    this.mix.gain.value = 0.82;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -15;
    this.compressor.knee.value = 22;
    this.compressor.ratio.value = 3.5;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.16;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.mix.connect(this.compressor);
    this.compressor.connect(this.master);
    this.master.connect(ctx.destination);

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.scene === 'quiet' ? 0 : 0.78;
    this.musicGain.connect(this.mix);
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 7200;
    this.musicFilter.Q.value = 0.45;
    this.musicFilter.connect(this.musicGain);
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 0.95;
    this.sfxGain.connect(this.mix);

    // A shaped, deterministic stereo impulse: diffuse and dark, no metallic slap.
    const impulseSeconds = 2.25;
    const impulse = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * impulseSeconds), ctx.sampleRate);
    let seed = 0x6d2b79f5;
    for (let ch = 0; ch < 2; ch++) {
      const samples = impulse.getChannelData(ch);
      let smoothed = 0;
      for (let i = 0; i < samples.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        const white = (seed >>> 0) / 2147483648 - 1;
        smoothed = smoothed * 0.68 + white * 0.32;
        const t = i / samples.length;
        samples[i] = smoothed * Math.pow(1 - t, 3.2) * Math.min(1, i / (ctx.sampleRate * 0.014));
      }
    }
    const room = ctx.createConvolver();
    room.buffer = impulse;
    this.roomSend = ctx.createGain();
    this.roomSend.gain.value = 0.25;
    const roomFilter = ctx.createBiquadFilter();
    roomFilter.type = 'highpass';
    roomFilter.frequency.value = 340;
    const roomWet = ctx.createGain();
    roomWet.gain.value = 0.65;
    this.roomSend.connect(roomFilter);
    roomFilter.connect(room);
    room.connect(roomWet);
    roomWet.connect(this.musicFilter);

    this.echoSend = ctx.createGain();
    this.echoSend.gain.value = 0.22;
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 60 / this.bpm() * 0.75;
    const echoFilter = ctx.createBiquadFilter();
    echoFilter.type = 'lowpass';
    echoFilter.frequency.value = 2800;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.30;
    const echoWet = ctx.createGain();
    echoWet.gain.value = 0.45;
    this.echoSend.connect(this.delay);
    this.delay.connect(echoFilter);
    echoFilter.connect(feedback);
    feedback.connect(this.delay);
    echoFilter.connect(echoWet);
    echoWet.connect(this.musicFilter);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.graphNodes = [this.mix, this.compressor, this.master, this.musicGain,
      this.musicFilter, this.sfxGain, this.roomSend, roomFilter, room, roomWet,
      this.echoSend, this.delay, echoFilter, feedback, echoWet];
  }

  private setMasterLevel(): void {
    if (!this.ctx || !this.master || this.disposed) return;
    const at = this.ctx.currentTime;
    const gain = this.master.gain;
    if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(at);
    else {
      const value = gain.value;
      gain.cancelScheduledValues(at);
      gain.setValueAtTime(value, at);
    }
    // A short linear fade reaches true digital silence, including effect tails.
    gain.linearRampToValueAtTime(this.muted ? 0 : this.volume, at + 0.035);
  }

  private bpm(): number {
    return this.scene === 'boss' ? 132 : this.scene === 'combat' ? 112 : 86;
  }

  private resetTransport(at: number): void {
    this.nextStepTime = at;
    this.step = 0;
    this.bar = 0;
  }

  // Audio-clock lookahead is independent of render-frame timing.
  private schedule = (): void => {
    const ctx = this.ctx;
    if (this.disposed || !this.unlocked || this.muted || this.scene === 'quiet' ||
      !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Never replay a backlog after tab throttling, suspension, or a long frame.
    if (this.nextStepTime < now - 0.08) this.resetTransport(now + 0.025);
    const sixteenth = 60 / this.bpm() / 4;
    let scheduled = 0;
    while (this.nextStepTime < now + 0.12 && scheduled++ < 8) {
      this.scoreStep(this.nextStepTime, this.step, this.bar, sixteenth);
      this.nextStepTime += sixteenth;
      this.step++;
      if (this.step === 16) { this.step = 0; this.bar++; }
    }
  };

  private scoreStep(at: number, step: number, bar: number, tick: number): void {
    const boss = this.scene === 'boss';
    const menu = this.scene === 'menu';
    const energy = boss ? Math.max(0.64, this.intensity) : this.intensity;
    const progressionIndex = Math.floor(bar / 2) % 4;
    const chord = boss ? BOSS_CHORDS[progressionIndex] : CHORDS[progressionIndex];
    const root = boss ? BOSS_ROOTS[progressionIndex] : ROOTS[progressionIndex];
    const beat = tick * 4;

    if (step === 0) {
      this.musicFilter?.frequency.setTargetAtTime(menu ? 4700 : 5600 + energy * 4400, at, 0.7);
      if (bar % 2 === 0) {
        const duration = beat * 8 + 0.3;
        for (let i = 0; i < chord.length; i++) {
          const hz = midi(chord[i]);
          this.tone({ at, hz, duration, level: menu ? 0.031 : 0.023,
            wave: 'triangle', attack: beat * 0.8, release: beat * 2.1,
            cutoff: menu ? 1450 : 1900, detune: i % 2 ? 4 : -4,
            music: true, room: true });
          this.tone({ at: at + 0.018, hz: hz * 2, duration,
            level: menu ? 0.010 : 0.008, wave: 'sine', attack: beat,
            release: beat * 2.6, detune: i % 2 ? -5 : 5, music: true, room: true });
        }
      }
      // Small shimmering accents define phrases without an endlessly busy lead.
      if (bar % 8 === 0) {
        this.bell(midi(chord[3] + 12), at + beat * 0.5, 0.026, beat * 2.3);
        this.bell(midi(chord[2] + 24), at + beat * 1.5, 0.020, beat * 2.0);
      }
    }

    if (menu) {
      if (step === 0 || step === 10) this.bass(midi(root), at, beat * 1.2, 0.049, false, 0);
      if (step % 4 === 2 || (bar % 4 === 3 && step === 13)) {
        const note = chord[ARP_ORDER[(Math.floor(step / 2) + bar) % 8]] + 12;
        this.bell(midi(note), at, 0.027, beat * 0.85);
      }
      // A very soft half-time heartbeat arrives after the first phrase.
      if (bar >= 4 && (step === 0 || step === 8)) this.kick(at, 0.19);
      if (bar >= 4 && step === 12) this.hat(at, 0.016, false);
      return;
    }

    const kickStep = step === 0 || step === 8 ||
      (boss && (step === 6 || step === 14)) ||
      (!boss && energy > 0.50 && step === 11) ||
      (!boss && energy > 0.80 && bar % 2 === 1 && step === 14);
    if (kickStep) this.kick(at, boss ? 0.43 : 0.35);
    if (step === 4 || step === 12) this.snare(at, boss ? 0.135 : 0.10);
    if (step % 2 === 0) this.hat(at + (step % 4 === 2 ? tick * 0.055 : 0),
      step % 4 === 2 ? 0.030 : 0.018, step === 14 && energy > 0.60);
    if (boss && step % 4 === 3) this.hat(at, 0.014, false);

    // Bass is slightly delayed after the kick to give each transient breathing room.
    if (step % 4 === 0 || step === 6 || (boss && (step === 10 || step === 14))) {
      const octave = step === 6 || step === 14 ? 12 : 0;
      this.bass(midi(root + octave), at + (kickStep ? 0.035 : 0),
        tick * (boss ? 1.5 : 2.15), boss ? 0.14 : 0.12, boss, energy);
    }

    if (step % 2 === 0 || (boss && energy > 0.82 && step % 4 === 3)) {
      const index = ARP_ORDER[(Math.floor(step / 2) + (bar % 2 ? 2 : 0)) % 8];
      const note = chord[index] + 12 + (boss && step === 14 ? 12 : 0);
      this.tone({ at: at + (step % 4 === 2 ? tick * 0.07 : 0), hz: midi(note),
        duration: tick * 1.9, level: (boss ? 0.026 : 0.021) + energy * 0.011,
        wave: boss ? 'sawtooth' : 'triangle', cutoff: 1300 + energy * 2500,
        attack: 0.007, release: tick * 1.55, music: true, room: true, echo: true });
    }

    // End-of-phrase details: a restrained fill and rising air before the downbeat.
    if (bar % 8 === 7 && step >= 12) {
      if (boss || step === 15) this.snare(at, step === 15 ? 0.075 : 0.035);
      if (step === 12) this.burst({ at, duration: beat, level: boss ? 0.052 : 0.031,
        frequency: 500, toFrequency: 6800, filter: 'bandpass', attack: beat * 0.7,
        music: true, room: true });
    }
    if (boss && step === 0 && bar % 4 === 0) {
      this.burst({ at, duration: beat * 2.7, level: 0.06,
        frequency: 6300, toFrequency: 1500, filter: 'highpass', music: true, room: true });
      this.tone({ at, hz: midi(root - 12), duration: beat * 1.8,
        level: 0.065, wave: 'sine', attack: 0.015, music: true });
    }
  }

  private kick(at: number, level: number): void {
    this.tone({ at, hz: 132, toHz: 43, duration: 0.22, level,
      wave: 'sine', attack: 0.002, music: true });
    this.tone({ at, hz: 980, toHz: 100, duration: 0.024,
      level: level * 0.10, wave: 'triangle', music: true });
  }

  private snare(at: number, level: number): void {
    this.burst({ at, duration: 0.145, level, frequency: 1900,
      filter: 'highpass', music: true, room: true });
    this.tone({ at, hz: 188, toHz: 132, duration: 0.09, level: level * 0.59,
      wave: 'triangle', music: true });
    this.burst({ at: at + 0.012, duration: 0.06, level: level * 0.23,
      frequency: 1400, filter: 'bandpass', q: 0.5, music: true });
  }

  private hat(at: number, level: number, open: boolean): void {
    this.burst({ at, duration: open ? 0.18 : 0.038, level,
      frequency: 7700, filter: 'highpass', music: true });
  }

  private bass(hz: number, at: number, duration: number, level: number,
    boss: boolean, energy: number): void {
    this.tone({ at, hz, duration, level, wave: 'triangle', attack: 0.008,
      release: duration * 0.6, cutoff: 650, music: true });
    this.tone({ at, hz: hz * (boss ? 1 : 2), duration, level: level * (boss ? 0.28 : 0.15),
      wave: 'sawtooth', attack: 0.012, release: duration * 0.7,
      cutoff: 330 + energy * 1050, detune: -3, music: true });
  }

  private bell(hz: number, at: number, level: number, duration: number): void {
    this.tone({ at, hz, duration, level, wave: 'sine', attack: 0.006,
      release: duration * 0.9, music: true, room: true, echo: true });
    this.tone({ at, hz: hz * 2.003, duration: duration * 0.52, level: level * 0.21,
      wave: 'sine', attack: 0.004, music: true, room: true });
  }

  private chime(notes: readonly number[], at: number, spacing: number,
    level: number, pitch: number): void {
    for (let i = 0; i < notes.length; i++) {
      const hz = midi(notes[i]) * pitch;
      this.tone({ at: at + i * spacing, hz, duration: 0.62, level,
        wave: 'sine', attack: 0.004, release: 0.56 });
      this.tone({ at: at + i * spacing, hz: hz * 2.001, duration: 0.23,
        level: level * 0.18, wave: 'sine', attack: 0.003 });
    }
  }

  private tone(p: Tone): void {
    const ctx = this.ctx;
    const destination = p.music ? this.musicFilter : this.sfxGain;
    if (!ctx || !destination || this.voices.size >= 112) return;
    const at = Math.max(ctx.currentTime, p.at);
    const end = at + Math.max(0.015, p.duration);
    const oscillator = ctx.createOscillator();
    oscillator.type = p.wave ?? 'sine';
    oscillator.frequency.setValueAtTime(clamp(p.hz, 18, 16000), at);
    if (p.toHz !== undefined) oscillator.frequency.exponentialRampToValueAtTime(
      clamp(p.toHz, 18, 16000), end);
    if (p.detune) oscillator.detune.value = p.detune;
    const envelope = ctx.createGain();
    const attack = Math.min(p.attack ?? 0.003, p.duration * 0.45);
    const release = Math.min(p.release ?? p.duration * 0.78, p.duration - attack);
    const peak = Math.max(0.0001, p.level);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(peak, at + attack);
    if (end - release > at + attack) {
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.73), end - release);
    }
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.gain.linearRampToValueAtTime(0, end + 0.01);
    const nodes: AudioNode[] = [envelope];
    if (p.cutoff) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(Math.min(ctx.sampleRate * 0.45, p.cutoff), at);
      filter.Q.value = 0.55;
      oscillator.connect(filter);
      filter.connect(envelope);
      nodes.push(filter);
    } else oscillator.connect(envelope);
    envelope.connect(destination);
    if (p.music && p.room && this.roomSend) envelope.connect(this.roomSend);
    if (p.music && p.echo && this.echoSend) envelope.connect(this.echoSend);
    this.track(oscillator, nodes, !!p.music);
    oscillator.start(at);
    oscillator.stop(end + 0.025);
  }

  private burst(p: Noise): void {
    const ctx = this.ctx;
    const destination = p.music ? this.musicFilter : this.sfxGain;
    if (!ctx || !destination || !this.noise || this.voices.size >= 112) return;
    const at = Math.max(ctx.currentTime, p.at);
    const duration = Math.max(0.015, p.duration);
    const end = at + duration;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = p.filter ?? 'bandpass';
    filter.frequency.setValueAtTime(clamp(p.frequency, 30, ctx.sampleRate * 0.45), at);
    filter.Q.value = p.q ?? 0.7;
    if (p.toFrequency !== undefined) filter.frequency.exponentialRampToValueAtTime(
      clamp(p.toFrequency, 30, ctx.sampleRate * 0.45), end);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(Math.max(0.0001, p.level),
      at + Math.min(p.attack ?? 0.003, duration * 0.8));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.gain.linearRampToValueAtTime(0, end + 0.01);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(destination);
    if (p.music && p.room && this.roomSend) envelope.connect(this.roomSend);
    this.track(source, [filter, envelope], !!p.music);
    source.start(at, Math.random() * 1.5);
    source.stop(end + 0.025);
  }

  private track(source: AudioScheduledSourceNode, nodes: AudioNode[], music: boolean): void {
    this.voices.add(source);
    if (music) this.musicVoices.add(source);
    source.onended = () => {
      source.disconnect();
      for (const node of nodes) node.disconnect();
      this.voices.delete(source);
      this.musicVoices.delete(source);
      source.onended = null;
    };
  }

  private stopVoices(sources: Set<AudioScheduledSourceNode>, at: number): void {
    for (const source of sources) {
      try { source.stop(at); } catch { /* A source may already have ended. */ }
    }
  }
}
