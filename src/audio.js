// A small, entirely procedural instrument rack. Audio is created only by unlock(),
// which should be called from a pointer or keyboard gesture.
const NOTES = [62, 65, 69, 72, 74, 77, 81, 84, 86];
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

class SurgeAudio {
  constructor() {
    this.enabled = true;
    this.musicEnabled = true;
    this.intensity = 0;
    this.context = null;
    this.master = null;
    this.voices = new Set();
    this.scheduler = null;
    this.wanted = false;
    this.mode = 'rush';
    this.step = 0;
    this.nextBeat = 0;
    this.noise = null;
    this.lastSelect = Number.NEGATIVE_INFINITY;
  }

  async unlock() {
    if (!this.enabled) return false;
    try {
      if (!this.context) {
        const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContext) return false;
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0.45;
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -12;
        limiter.knee.value = 12;
        limiter.ratio.value = 5;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.18;
        this.master.connect(limiter);
        limiter.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') await this.context.resume();
      if (this.wanted) this.beginMusic();
      return this.context.state === 'running';
    } catch {
      // Sound is an enhancement; blocked/unsupported audio never blocks a run.
      return false;
    }
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.silence();
    else if (this.wanted) this.beginMusic();
  }

  setMusicEnabled(enabled) {
    this.musicEnabled = Boolean(enabled);
    if (!this.musicEnabled) {
      this.clearScheduler();
      this.releaseVoices('music');
    } else if (this.wanted) this.beginMusic();
  }

  setIntensity(amount) {
    this.intensity = Math.max(0, Math.min(1, Number(amount) || 0));
  }

  start(mode = 'rush') {
    this.mode = mode;
    this.wanted = true;
    this.beginMusic();
  }

  stop() {
    this.wanted = false;
    this.silence();
  }

  clearScheduler() {
    if (this.scheduler !== null) globalThis.clearInterval(this.scheduler);
    this.scheduler = null;
  }

  silence() {
    this.clearScheduler();
    this.releaseVoices();
  }

  releaseVoices(group) {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      if (group && voice.group !== group) continue;
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0, now, 0.006);
        voice.source.stop(now + 0.025);
      } catch { /* Already-finished voices can be released harmlessly. */ }
    }
  }

  get ready() {
    return this.enabled && this.context?.state === 'running';
  }

  tone(note, delay = 0, duration = 0.22, volume = 0.1, options = {}) {
    if (!this.ready || this.voices.size > 72) return;
    const ctx = this.context;
    const start = ctx.currentTime + Math.max(0, delay);
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    oscillator.type = options.wave || 'sine';
    oscillator.frequency.setValueAtTime(hz(note), start);
    if (options.slide) oscillator.frequency.exponentialRampToValueAtTime(hz(note + options.slide), start + duration);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(options.cutoff || 4800, start);
    const attack = Math.min(options.attack || 0.009, duration / 3);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    const voice = { source: oscillator, gain, group: options.group || 'fx' };
    this.voices.add(voice);
    oscillator.onended = () => {
      this.voices.delete(voice);
      oscillator.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + duration + 0.025);
  }

  tick(delay = 0, volume = 0.025, cutoff = 5200) {
    if (!this.ready || this.voices.size > 72) return;
    const ctx = this.context;
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.08), ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const start = ctx.currentTime + Math.max(0, delay);
    source.buffer = this.noise;
    filter.type = 'highpass';
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.055);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    const voice = { source, gain, group: 'music' };
    this.voices.add(voice);
    source.onended = () => {
      this.voices.delete(voice);
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    source.start(start);
    source.stop(start + 0.08);
  }

  beginMusic() {
    if (!this.ready || !this.musicEnabled || !this.wanted || this.scheduler !== null) return;
    this.nextBeat = this.context.currentTime + 0.05;
    this.step = 0;
    const schedule = () => {
      if (!this.ready || !this.musicEnabled || !this.wanted) {
        this.clearScheduler();
        return;
      }
      // A short lookahead keeps time without queuing music far beyond a pause.
      const now = this.context.currentTime;
      if (this.nextBeat < now - 0.2) this.nextBeat = now + 0.025;
      while (this.nextBeat < now + 0.18) {
        this.musicStep(this.step, this.nextBeat - now);
        this.step += 1;
        this.nextBeat += 60 / (this.mode === 'zen' ? 72 : 88) / 2;
      }
    };
    schedule();
    this.scheduler = globalThis.setInterval(schedule, 85);
  }

  musicStep(step, delay) {
    const roots = [38, 43, 36, 45];
    const root = roots[Math.floor(step / 32) % roots.length];
    const beat = step % 16;
    const options = { group: 'music', wave: 'triangle', cutoff: 850 };
    // A round, sparse bass pulse; the musical space leaves room for tile notes.
    if (beat === 0 || beat === 8 || (this.intensity > 0.5 && beat === 14)) {
      this.tone(root, delay, 0.55, 0.065, options);
      this.tone(30, delay, 0.13, 0.035, { ...options, wave: 'sine', slide: -10 });
    }
    if (beat === 4 || beat === 12) this.tick(delay, 0.014, 3400);
    if (this.intensity > 0.65 && beat % 2 === 1) this.tick(delay, 0.009, 6800);
    // Slowly changing, breathy chords instead of a looping lead melody.
    if (step % 32 === 0) {
      [12, 19, 26].forEach((interval, i) => {
        this.tone(root + interval, delay + i * 0.04, 3.8, 0.018, {
          ...options, wave: 'sine', cutoff: 2200, attack: 0.6,
        });
      });
    }
    if (beat === 6 || (beat === 15 && this.intensity > 0.3)) {
      const intervals = [24, 31, 33, 38];
      const interval = intervals[(Math.floor(step / 16) + beat) % intervals.length];
      this.tone(root + interval, delay, 0.65, 0.023, { group: 'music', cutoff: 2200 });
    }
  }

  play(type, detail = {}) {
    if (!this.ready) return;
    switch (type) {
      case 'select': {
        // Prevent pointer jitter from producing dozens of simultaneous attacks.
        const now = this.context.currentTime;
        if (now - this.lastSelect < 0.025) return;
        this.lastSelect = now;
        const step = Math.max(0, Math.floor(Number(detail.step) || 0));
        const note = NOTES[Math.min(step, NOTES.length - 1)];
        this.tone(note, 0, 0.17, 0.12, { wave: 'triangle', cutoff: 3200 });
        this.tone(note + 12, 0.008, 0.09, 0.025);
        break;
      }
      case 'undo':
        this.tone(69, 0, 0.11, 0.07, { slide: -5 });
        break;
      case 'invalid':
        this.tone(48, 0, 0.19, 0.09, { wave: 'triangle', cutoff: 700, slide: -2 });
        this.tone(55, 0.065, 0.13, 0.045, { cutoff: 900 });
        break;
      case 'clear': {
        const combo = Math.max(1, Math.min(5, Number(detail.combo) || 1));
        const lift = combo > 2 ? 5 : 0;
        [62, 69, 74, 77].forEach((note, i) => this.tone(note + lift, i * 0.036, 0.42, 0.075));
        this.tone(38 + lift, 0, 0.3, 0.15, { wave: 'triangle', cutoff: 900 });
        if (Number(detail.length) >= 5) this.tone(86 + lift, 0.15, 0.5, 0.055);
        break;
      }
      case 'surge':
        [50, 57, 62, 65, 69, 74, 77, 81].forEach((note, i) => {
          this.tone(note, i * 0.055, 0.5, 0.08, { wave: 'triangle', cutoff: 4200 });
        });
        this.tone(38, 0, 0.65, 0.16, { cutoff: 700 });
        break;
      case 'countdown':
        this.tone(74, 0, 0.09, 0.07);
        this.tone(86, 0, 0.065, 0.025);
        break;
      case 'end':
        [62, 69, 65, 74].forEach((note, i) => this.tone(note, i * 0.15, 0.8, 0.075));
        this.tone(38, 0.45, 1.2, 0.09, { wave: 'triangle', cutoff: 800 });
        break;
      case 'shuffle':
        [74, 69, 65, 62, 69, 77].forEach((note, i) => {
          this.tone(note, i * 0.035, 0.12, 0.06, { wave: 'triangle' });
        });
        break;
      case 'hint':
        [74, 81, 86].forEach((note, i) => this.tone(note, i * 0.1, 0.38, 0.065));
        break;
      case 'ui':
        this.tone(74, 0, 0.08, 0.045, { wave: 'triangle', cutoff: 2400 });
        break;
      default:
        break;
    }
  }
}

export const sound = new SurgeAudio();
export default sound;
