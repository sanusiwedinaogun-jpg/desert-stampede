/**
 * Audio manager for procedural sound effects and the bundled music playlist.
 */

const MUSIC_TRACKS = [
  'Terminal Stride.m4a',
  'Scorched Horizon.m4a',
  'Salt and Steel.m4a',
  'Red Clay Run.m4a',
  'Red Clay Run (Take 2).m4a',
  'Past the Ridge.m4a',
  'Outrun the Wall.m4a',
  'Outrun the Wall (Take 2).m4a',
  'Flint and Thunder (Take 2).m4a'
];

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.initialized = false;
    this.muted = false;
    this.musicAudio = null;
    this.musicTrackIndex = 0;
    this.musicPaused = false;

    // Hoof beat state
    this.hoofInterval = null;
    this.hoofSpeed = 0;
    this.lastHoofTime = 0;

    // Wind ambience state
    this.windNode = null;
    this.windGain = null;
    this.windFilter = null;

    // Cached shared noise buffer for procedural audio generation
    this.noiseBuffer = null;
  }

  init() {
    if (this.initialized) return;

    // Must be invoked after user interaction (pointer down / key press)
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.warn('Web Audio API is not supported in this browser.');
      return;
    }

    this.ctx = new AudioContextClass();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
    this.masterGain.gain.setValueAtTime(0.3, this.ctx.currentTime);

    this.createNoiseBuffer();
    this.startWind();
    this.initialized = true;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(err => {
        console.warn('AudioContext resume failed:', err);
      });
    }
  }

  startMusic() {
    if (!this.initialized || this.muted || !this.ctx || this.musicAudio) return;

    this.musicAudio = new Audio();
    this.musicAudio.preload = 'auto';
    const musicGain = this.ctx.createGain();
    musicGain.gain.setValueAtTime(0.4, this.ctx.currentTime);
    musicGain.connect(this.masterGain);
    this.ctx.createMediaElementSource(this.musicAudio).connect(musicGain);

    this.musicAudio.addEventListener('ended', () => {
      if (this.musicPaused) return;
      this.musicTrackIndex = (this.musicTrackIndex + 1) % MUSIC_TRACKS.length;
      this.musicAudio.src = this.getMusicTrackUrl();
      this.musicAudio.play().catch(err => {
        console.warn('Background music playback failed:', err);
      });
    });
    this.musicAudio.addEventListener('error', () => {
      console.error(`Unable to load background music: ${this.musicAudio.currentSrc}`);
    });
    this.musicAudio.src = this.getMusicTrackUrl();
    this.musicAudio.play().catch(err => {
      console.warn('Background music playback failed:', err);
    });
  }

  getMusicTrackUrl() {
    return new URL(`../music/${encodeURIComponent(MUSIC_TRACKS[this.musicTrackIndex])}`, import.meta.url).href;
  }

  pauseMusic() {
    this.musicPaused = true;
    this.musicAudio?.pause();
  }

  resumeMusic() {
    this.musicPaused = false;
    if (!this.musicAudio) {
      this.startMusic();
    } else if (!this.muted) {
      this.musicAudio.play().catch(err => {
        console.warn('Background music playback failed:', err);
      });
    }
  }

  createNoiseBuffer() {
    if (!this.ctx) return;
    const sampleRate = this.ctx.sampleRate;
    const duration = 2.0; // 2 seconds of pre-generated white noise
    const frameCount = sampleRate * duration;

    this.noiseBuffer = this.ctx.createBuffer(1, frameCount, sampleRate);
    const channelData = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = Math.random() * 2 - 1;
    }
  }

  playHoof() {
    if (!this.initialized || this.muted || !this.ctx || !this.noiseBuffer) return;

    const now = this.ctx.currentTime;

    // 1. High/Mid textured dirt crunch (filtered noise bandpass)
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = this.noiseBuffer;

    // Randomize buffer start offset to avoid repetitive phase
    const maxOffset = Math.max(0, this.noiseBuffer.duration - 0.1);
    const startOffset = Math.random() * maxOffset;

    const bandpass = this.ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    const centerFreq = 750 + Math.random() * 150; // Randomize around 800Hz
    bandpass.frequency.setValueAtTime(centerFreq, now);
    bandpass.Q.setValueAtTime(2.0, now);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.linearRampToValueAtTime(0.15, now + 0.001);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

    noiseSource.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseGain.connect(this.masterGain);

    noiseSource.start(now, startOffset, 0.06);

    // 2. Low-frequency tactile impact thud (quick decaying sine wave)
    const thudOsc = this.ctx.createOscillator();
    const thudGain = this.ctx.createGain();

    thudOsc.type = 'sine';
    const startPitch = 110 + Math.random() * 25;
    thudOsc.frequency.setValueAtTime(startPitch, now);
    thudOsc.frequency.exponentialRampToValueAtTime(35, now + 0.04);

    thudGain.gain.setValueAtTime(0.12, now);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

    thudOsc.connect(thudGain);
    thudGain.connect(this.masterGain);

    thudOsc.start(now);
    thudOsc.stop(now + 0.045);
  }

  startWind() {
    if (!this.ctx || !this.noiseBuffer) return;

    // Continuous wind background loop
    this.windNode = this.ctx.createBufferSource();
    this.windNode.buffer = this.noiseBuffer;
    this.windNode.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.setValueAtTime(400, this.ctx.currentTime);

    this.windGain = this.ctx.createGain();
    this.windGain.gain.setValueAtTime(0.05, this.ctx.currentTime);

    // Slow LFO to modulate filter cutoff frequency, mimicking shifting desert breeze
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.25, this.ctx.currentTime); // ~4-second cycle

    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(80, this.ctx.currentTime); // +/- 80 Hz variance

    lfo.connect(lfoGain);
    lfoGain.connect(this.windFilter.frequency);
    lfo.start();

    this.windNode.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);

    this.windNode.start();
  }

  setHoofSpeed(speed) {
    // Adjust hoof beat interval based on horse speed
    // Higher speed = faster beats
    // Map speed 0-40 to interval 0.6s - 0.12s
    // If speed < 1, no hoofbeats
    this.hoofSpeed = speed;
  }

  setWindSpeed(speed) {
    if (!this.initialized || !this.windGain || !this.ctx) return;

    const clampedSpeed = Math.max(0, Math.min(speed, 50));
    const targetVol = 0.02 + (clampedSpeed / 40) * 0.12;

    this.windGain.gain.linearRampToValueAtTime(targetVol, this.ctx.currentTime + 0.1);

    if (this.windFilter) {
      const targetCutoff = 400 + (clampedSpeed / 40) * 600;
      this.windFilter.frequency.linearRampToValueAtTime(targetCutoff, this.ctx.currentTime + 0.1);
    }
  }

  playCountdownBeep(final = false) {
    if (!this.initialized || this.muted || !this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    const freq = final ? 880 : 440;
    const duration = final ? 0.3 : 0.15;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playFinish() {
    if (!this.initialized || this.muted || !this.ctx) return;

    // Ascending celebratory fanfare: C5, E5, G5
    const now = this.ctx.currentTime;
    const notes = [
      { freq: 523.25, offset: 0.0, dur: 0.15 },
      { freq: 659.25, offset: 0.15, dur: 0.15 },
      { freq: 783.99, offset: 0.30, dur: 0.40 }
    ];

    notes.forEach(note => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      const startTime = now + note.offset;
      const endTime = startTime + note.dur;

      osc.frequency.setValueAtTime(note.freq, startTime);

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(0.25, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(startTime);
      osc.stop(endTime + 0.02);
    });
  }

  update(dt) {
    if (!this.initialized || !this.ctx) return;

    // Check if it's time for next hoof beat based on hoofSpeed
    const now = this.ctx.currentTime;
    if (this.hoofSpeed > 1) {
      const clampedSpeed = Math.min(this.hoofSpeed, 40);
      const interval = Math.max(0.12, 0.6 - (clampedSpeed / 40) * 0.48);
      if (now - this.lastHoofTime > interval) {
        this.playHoof();
        this.lastHoofTime = now;
      }
    }
  }

  mute() {
    this.muted = true;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime);
    }
  }

  unmute() {
    this.muted = false;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    }
  }
}
